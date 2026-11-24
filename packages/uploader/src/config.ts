import * as z from 'zod';

// What the server gives the uploader island, in the page (`/matches/:id/replays`): the match,
// the parser build to load, and the accounts it knows. Known accounts are sent as SHA-256 hashes:
// the browser hashes the accounts it reads in the files and compares, so the page never shows a
// player's Ubisoft profile ID (M-42).

/** The texts the island shows, from the server's message catalog (`web.replays.ui.<key>`). */
export const UPLOADER_MESSAGES = [
  'pick',
  'pickHelp',
  'noFolders',
  'folder',
  'folderRounds',
  'outsideWindow',
  'parse',
  'parsing',
  'parseFailed',
  'lobby',
  'lobbyRounds',
  'notCustom',
  'unknownTeams',
  'unknownPlayer',
  'round',
  'roundCut',
  'send',
  'sending',
  'uploading',
  'uploaded',
  'reload',
  'parserChanged',
  'done',
  'back',
  'retry',
  'error',
  'refused.not_a_replay',
  'refused.invalid',
  'refused.not_bomb',
  'refused.not_this_match',
  'refused.other_match',
  'status.failed',
  'moss.title',
  'moss.help',
  'moss.none',
  'moss.sent',
  'moss.missing',
  'moss.sending',
  'moss.failed',
  'moss.tooLarge',
] as const;
export type UploaderMessage = (typeof UPLOADER_MESSAGES)[number];

const side = z.enum(['a', 'b']);
const team = z.strictObject({ name: z.string(), tag: z.string() });

export const uploaderConfigSchema = z.strictObject({
  matchId: z.int(),
  /** The session's CSRF token, sent in a header with every API request. */
  csrf: z.string(),
  /** The match page, to go back to. */
  matchUrl: z.string(),
  parser: z.strictObject({
    version: z.string(),
    /** The `.wasm` file's address. */
    wasm: z.string(),
    /** The Web Worker script: Go's loader and the parser's side of the channel. */
    worker: z.string(),
  }),
  /** The league's trade window (`replays.trade_window_s`), for the preview's facts. */
  tradeWindowS: z.int(),
  /** Known players a side needs to be a team (`replays.min_known_players`). */
  minKnown: z.int(),
  /** Unix milliseconds: folders recorded in this span are picked by default. */
  window: z.strictObject({ start: z.number(), end: z.number() }),
  teams: z.strictObject({ a: team, b: team }),
  /** Each known R6 account, by its SHA-256: its side and the player's name on Ligo. */
  known: z.array(z.strictObject({ hash: z.string(), side, name: z.string() })),
  /**
   * The MOSS files this person may send (M-47): their own, or their side's as an official, for
   * the players the replays show. Null where the league does not ask for them.
   */
  moss: z
    .strictObject({
      maxBytes: z.int(),
      players: z.array(
        z.strictObject({ playerId: z.int(), name: z.string(), side, hasFile: z.boolean() }),
      ),
    })
    .nullable(),
  messages: z.record(z.enum(UPLOADER_MESSAGES), z.string()),
});
export type UploaderConfig = z.infer<typeof uploaderConfigSchema>;
export type KnownAccount = UploaderConfig['known'][number];

/** A message with its `{name}` parts filled in. */
export function format(text: string, values: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}
