import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLocalTranscriptStore, transcriptKey } from './transcript-store.ts';

describe('createLocalTranscriptStore', () => {
  it('writes a transcript under its season, leaving no partial file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ligo-transcripts-'));
    const store = createLocalTranscriptStore(root);
    await store.put(transcriptKey(4, 123), '{"messages":[]}');
    expect(readdirSync(join(root, 'transcripts', '4'))).toEqual(['123.json']);
    expect(readFileSync(join(root, 'transcripts', '4', '123.json'), 'utf8')).toBe(
      '{"messages":[]}',
    );
  });

  it.each([
    ['a key outside the transcripts', 'evidence/3/a.json'],
    ['a key that climbs out of the folder', 'transcripts/4/../../123.json'],
    ['a name that is not a match', 'transcripts/4/notes.json'],
  ])('refuses %s', async (_name, key) => {
    const store = createLocalTranscriptStore(mkdtempSync(join(tmpdir(), 'ligo-transcripts-')));
    await expect(store.put(key, '{}')).rejects.toThrow('Not a transcript key');
  });
});
