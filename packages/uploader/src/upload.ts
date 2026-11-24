// Sending what was read (design doc section 8, upload flow 4 and 5): the rounds' JSON in batches
// the API takes, then the raw files, 3 at a time. Links are signed a few files ahead and the
// files sent are reported in groups, so a whole best-of-five stays far below the API's request
// limits. The network calls are passed in: the queue is tested without a browser.

/** What `/api/replays` takes per request: 64 files, 2 MB; a margin is kept for the rest. */
export const SUBMIT_MAX_FILES = 64;
export const SUBMIT_MAX_BYTES = 1_500_000;

/** Splits the files into requests the API takes, in order, by their JSON size. */
export function submitBatches<T>(
  files: readonly T[],
  maxFiles = SUBMIT_MAX_FILES,
  maxBytes = SUBMIT_MAX_BYTES,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const file of files) {
    const size = JSON.stringify(file).length;
    if (current.length > 0 && (current.length >= maxFiles || bytes + size > maxBytes)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export interface SignedLink {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

/** What the API answers for each file to sign. */
export type SignAnswer = ({ id: number } & SignedLink) | { id: number; error: string };

export type PutResult = 'ok' | 'expired' | 'failed';
export type UploadStatus = 'uploading' | 'stored' | 'failed';

export interface UploadDeps {
  sign(ids: number[]): Promise<SignAnswer[]>;
  /** Sends one raw file to its link, reporting the fraction sent. */
  put(id: number, link: SignedLink, onProgress: (fraction: number) => void): Promise<PutResult>;
  /** Reports files sent; answers each one's status (`stored`, or not). */
  stored(ids: number[]): Promise<{ id: number; status: string }[]>;
  onProgress(id: number, fraction: number): void;
  onStatus(id: number, status: UploadStatus): void;
}

export interface UploadOptions {
  concurrency: number;
  /** Links asked for at once, and files reported at once. */
  group: number;
}

/**
 * Sends each file's raw bytes: `concurrency` at a time, each link signed shortly before its file.
 * A link refused (expired) or a failed send is tried once more with a new link. Resolves with
 * each file's final status.
 */
export async function uploadRaw(
  ids: readonly number[],
  deps: UploadDeps,
  options: UploadOptions = { concurrency: 3, group: 6 },
): Promise<Map<number, UploadStatus>> {
  const statuses = new Map<number, UploadStatus>();
  const queue = [...new Set(ids)];
  const links = new Map<number, Promise<SignedLink | null>>();

  /** The id's link, signing it with the next files of the queue that have none yet. */
  const linkOf = (id: number, fresh = false): Promise<SignedLink | null> => {
    const known = links.get(id);
    if (known && !fresh) return known;
    const batch = fresh
      ? [id]
      : [id, ...queue.filter((next) => next !== id && !links.has(next))].slice(0, options.group);
    const answers = deps.sign(batch).catch((): SignAnswer[] => []);
    for (const member of batch) {
      links.set(
        member,
        answers.then((list) => {
          const answer = list.find((entry) => entry.id === member);
          return answer && !('error' in answer) ? answer : null;
        }),
      );
    }
    return links.get(id) ?? Promise.resolve(null);
  };

  let sent: number[] = [];
  const report = async (ids: number[]) => {
    if (ids.length === 0) return;
    const answers = await deps.stored(ids).catch(() => []);
    for (const id of ids) {
      const stored = answers.some((entry) => entry.id === id && entry.status === 'stored');
      statuses.set(id, stored ? 'stored' : 'failed');
      deps.onStatus(id, stored ? 'stored' : 'failed');
    }
  };

  const sendOne = async (id: number) => {
    deps.onStatus(id, 'uploading');
    for (const attempt of [0, 1]) {
      const link = await linkOf(id, attempt > 0);
      const result: PutResult = link
        ? await deps.put(id, link, (fraction) => {
            deps.onProgress(id, fraction);
          })
        : 'failed';
      if (result === 'ok') {
        sent.push(id);
        if (sent.length >= options.group) {
          const group = sent;
          sent = [];
          await report(group);
        }
        return;
      }
    }
    statuses.set(id, 'failed');
    deps.onStatus(id, 'failed');
  };

  const worker = async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) await sendOne(id);
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, queue.length) }, worker));
  await report(sent);
  return statuses;
}
