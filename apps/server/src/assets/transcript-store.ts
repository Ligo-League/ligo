import { createDiskObjectStore, type ObjectStore } from './object-store.ts';

// Match channel transcripts, saved when a season closes (design doc section 6, "Season end"),
// under keys like "transcripts/4/123.json" (season, match; section 13, R2 layout): in R2, or in
// the storage folder on a machine without R2 settings. Nothing serves
// them: they hold the teams' private conversations, for staff to look at by hand if needed.

/** The only keys the store writes: one file per match, under its season. */
export const TRANSCRIPT_KEY = /^transcripts\/[1-9]\d{0,9}\/[1-9]\d{0,9}\.json$/;

export const transcriptKey = (seasonId: number, matchId: number) =>
  `transcripts/${String(seasonId)}/${String(matchId)}.json`;

export interface TranscriptStore {
  /** Writes the transcript; one already there under the key is replaced. */
  put(key: string, json: string): Promise<void>;
}

/** Transcripts in an object store: R2 in production, a folder on disk without R2 settings. */
export function createTranscriptStore(objects: ObjectStore): TranscriptStore {
  return {
    async put(key, json) {
      if (!TRANSCRIPT_KEY.test(key)) throw new Error('Not a transcript key');
      await objects.put(key, new TextEncoder().encode(json), 'application/json');
    },
  };
}

/** Files under a folder on disk, `data/storage` by default. */
export function createLocalTranscriptStore(root: string): TranscriptStore {
  return createTranscriptStore(createDiskObjectStore(root, { upload: null, now: Date.now }));
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
