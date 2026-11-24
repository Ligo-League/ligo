import * as z from 'zod';
import type { PutResult, SignAnswer, SignedLink } from './upload.ts';

// The replay API as the island calls it (`apps/server/src/web/replay-api.ts`): JSON with the
// session's CSRF token in a header. A request refused for its rate is sent again once the
// server says it may be; the raw files go to their signed link with progress (XMLHttpRequest,
// since fetch reports no upload progress).

const RETRIES = 3;
/** The longest wait the island accepts before giving up on a request. */
const MAX_WAIT_MS = 60_000;

export interface FileToSubmit {
  name: string;
  size: number;
  sha256: string;
  round: unknown;
}

const outcomeSchema = z.union([
  z.object({ sha256: z.string(), status: z.literal('stored'), id: z.int() }),
  z.object({ sha256: z.string(), status: z.literal('duplicate'), id: z.int(), raw: z.string() }),
  z.object({ sha256: z.string(), status: z.literal('refused'), error: z.string() }),
]);
export type SubmitOutcome = z.infer<typeof outcomeSchema>;

const signSchema = z.object({
  files: z.array(
    z.union([
      z.object({
        id: z.int(),
        url: z.string(),
        method: z.literal('PUT'),
        headers: z.record(z.string(), z.string()),
      }),
      z.object({ id: z.int(), error: z.string() }),
    ]),
  ),
});
const storedSchema = z.object({ files: z.array(z.object({ id: z.int(), status: z.string() })) });

export type SubmitReply =
  | { ok: true; files: SubmitOutcome[] }
  | { ok: false; error: 'parser_version' | 'failed'; status: number };

const mossSignedSchema = z.object({
  key: z.string(),
  url: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
});

export interface ReplayApi {
  /** A link for a player's MOSS file, or the server's reason for refusing it. */
  mossSign(
    playerId: number,
    name: string,
    size: number,
  ): Promise<({ ok: true; key: string } & SignedLink) | { ok: false }>;
  mossStored(playerId: number, key: string): Promise<boolean>;
  submit(parser: string, files: FileToSubmit[]): Promise<SubmitReply>;
  sign(ids: number[]): Promise<SignAnswer[]>;
  stored(ids: number[]): Promise<{ id: number; status: string }[]>;
  put(link: SignedLink, file: Blob, onProgress: (fraction: number) => void): Promise<PutResult>;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createReplayApi(matchId: number, csrf: string): ReplayApi {
  const call = async (path: string, body: object) => {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ matchId, ...body }),
      });
      const after = Number(response.headers.get('retry-after') ?? '1') * 1000;
      if (response.status === 429 && attempt < RETRIES && after <= MAX_WAIT_MS) {
        await wait(after);
        continue;
      }
      return {
        status: response.status,
        json: (await response.json().catch(() => null)) as unknown,
      };
    }
  };
  const failed = (status: number): Error => new Error(`The server answered ${String(status)}`);

  return {
    async mossSign(playerId, name, size) {
      const { status, json } = await call('/api/moss/sign', { playerId, name, size });
      const parsed = mossSignedSchema.safeParse(json);
      return status === 200 && parsed.success ? { ok: true, ...parsed.data } : { ok: false };
    },
    async mossStored(playerId, key) {
      const { status } = await call('/api/moss/stored', { playerId, key });
      return status === 200;
    },
    async submit(parser, files) {
      const { status, json } = await call('/api/replays', { parser, files });
      if (
        status === 409 &&
        z.object({ error: z.literal('parser_version') }).safeParse(json).success
      ) {
        return { ok: false, error: 'parser_version', status };
      }
      const parsed = z.object({ files: z.array(outcomeSchema) }).safeParse(json);
      return status === 200 && parsed.success
        ? { ok: true, files: parsed.data.files }
        : { ok: false, error: 'failed', status };
    },
    async sign(ids) {
      const { status, json } = await call('/api/replays/sign', { ids });
      const parsed = signSchema.safeParse(json);
      if (status !== 200 || !parsed.success) throw failed(status);
      return parsed.data.files;
    },
    async stored(ids) {
      const { status, json } = await call('/api/replays/stored', { ids });
      const parsed = storedSchema.safeParse(json);
      if (status !== 200 || !parsed.success) throw failed(status);
      return parsed.data.files;
    },
    put(link, file, onProgress) {
      return new Promise((resolve) => {
        const request = new XMLHttpRequest();
        request.open(link.method, link.url);
        for (const [name, value] of Object.entries(link.headers)) {
          request.setRequestHeader(name, value);
        }
        request.upload.onprogress = (event) => {
          if (event.lengthComputable) onProgress(event.loaded / event.total);
        };
        request.onload = () => {
          if (request.status >= 200 && request.status < 300) resolve('ok');
          // A link past its time, or refused: a new one may work.
          else resolve(request.status === 403 ? 'expired' : 'failed');
        };
        request.onerror = () => {
          resolve('failed');
        };
        request.send(file);
      });
    },
  };
}
