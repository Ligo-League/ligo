// What an R6 round replay looks like before parsing: a `.rec` file (the game names them
// `Match-<date>-R01.rec`) starting with the bytes `dissect\0`. Builds before Y8 compressed the
// whole file, so it starts with the zstd frame magic instead; r6-dissect reads both.

const DISSECT = [0x64, 0x69, 0x73, 0x73, 0x65, 0x63, 0x74, 0x00];
const ZSTD = [0x28, 0xb5, 0x2f, 0xfd];

const startsWith = (head: Uint8Array, magic: readonly number[]) =>
  head.length >= magic.length && magic.every((byte, index) => head[index] === byte);

/** Bytes of a file's start that `acceptsR6` needs. */
export const R6_HEAD_BYTES = DISSECT.length;

/** Whether a file is an R6 round replay, from its name and its first `R6_HEAD_BYTES` bytes. */
export function acceptsR6(name: string, head: Uint8Array): boolean {
  return (
    name.toLowerCase().endsWith('.rec') && (startsWith(head, DISSECT) || startsWith(head, ZSTD))
  );
}
