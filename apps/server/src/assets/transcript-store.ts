import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Match channel transcripts, saved when a season closes (design doc section 6, "Season end"),
// under keys like "transcripts/4/123.json" (season, match; section 13, R2 layout). Until R2
// (phase 5) they live in the storage folder, which is copied to R2 every night. Nothing serves
// them: they hold the teams' private conversations, for staff to look at by hand if needed.

/** The only keys the store writes: one file per match, under its season. */
export const TRANSCRIPT_KEY = /^transcripts\/[1-9]\d{0,9}\/[1-9]\d{0,9}\.json$/;

export const transcriptKey = (seasonId: number, matchId: number) =>
  `transcripts/${String(seasonId)}/${String(matchId)}.json`;

export interface TranscriptStore {
  /** Writes the transcript; one already there under the key is replaced. */
  put(key: string, json: string): Promise<void>;
}

/** Files under a folder on disk, `data/storage` by default. */
export function createLocalTranscriptStore(root: string): TranscriptStore {
  return {
    async put(key, json) {
      if (!TRANSCRIPT_KEY.test(key)) throw new Error('Not a transcript key');
      const path = join(root, key);
      await mkdir(dirname(path), { recursive: true });
      // Written aside then renamed, so the nightly copy never takes half a file.
      const partial = `${path}.partial`;
      await writeFile(partial, json, 'utf8');
      await rename(partial, path);
    },
  };
}

/** An in-memory store for tests; `failing` makes the next writes fail, as a full disk would. */
export function fakeTranscriptStore(): TranscriptStore & {
  files: Map<string, string>;
  failing: boolean;
} {
  const store = {
    files: new Map<string, string>(),
    failing: false,
    put(key: string, json: string) {
      if (store.failing || !TRANSCRIPT_KEY.test(key)) return Promise.reject(new Error('Not saved'));
      store.files.set(key, json);
      return Promise.resolve();
    },
  };
  return store;
}
