import { z } from 'zod';

// One round as the r6-dissect fork's `parseRound` returns it (parsers/r6, cmd/wasm): the header,
// the kill feed (`matchFeedback`) and the scoreboard (`stats`). Only what the normaliser reads is
// checked; the fork's other fields pass through unread. Go leaves out empty optional fields, and
// writes an empty list as null.

const named = z.object({ name: z.string() });

const team = z.object({
  startingScore: z.int().min(0),
  won: z.boolean(),
  winCondition: z.string().optional(),
  role: z.enum(['Attack', 'Defense']),
});

const player = z.object({
  profileID: z.string(),
  username: z.string().min(1),
  teamIndex: z.union([z.literal(0), z.literal(1)]),
  operator: named.optional(),
});

const feedEvent = z.object({
  type: named,
  username: z.string().optional(),
  target: z.string().optional(),
  headshot: z.boolean().optional(),
  teamKill: z.boolean().optional(),
  /** Unset when the round's clock never started, as in builds before the fork read it. */
  phase: z.string().optional(),
  /** Seconds since the action phase started, negative in the preparation phase. */
  elapsedSeconds: z.number(),
  operator: named.optional(),
});

const scoreboardRow = z.object({
  username: z.string(),
  kills: z.int().min(0),
  died: z.boolean(),
  assists: z.int().min(0),
});

export const dissectRoundSchema = z.object({
  gameVersion: z.string(),
  timestamp: z.string().min(1),
  matchType: named,
  map: named,
  site: z.string().optional(),
  recordingProfileID: z.string().optional(),
  gamemode: named,
  roundNumber: z.int().min(0),
  matchID: z.string().min(1),
  teams: z.tuple([team, team]),
  players: z.array(player),
  matchFeedback: z.array(feedEvent).nullable(),
  stats: z.array(scoreboardRow).nullable(),
});
export type DissectRound = z.infer<typeof dissectRoundSchema>;
export type DissectEvent = z.infer<typeof feedEvent>;
