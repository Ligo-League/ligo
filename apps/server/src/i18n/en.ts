import type { MessageKey } from './fr.ts';

export const en: Record<MessageKey, string> = {
  'command.ping.description': 'Check that the bot is responding.',
  'ping.reply': 'Pong! Gateway latency: {gatewayMs} ms.',
  'ping.replyNoLatency': 'Pong!',
  'command.standings.description': 'Show the standings of the current season.',
  'command.standings.option.division': 'Division, for example "Ligue 1" or "L1". All by default.',
  'command.standings.option.format': 'Image (the default) or a text table.',
  'command.standings.option.format.image': 'Image',
  'command.standings.option.format.text': 'Text',
  'standings.title': '{competition} · {season} · {division}',
  'standings.subtitle': '{competition} · {season}',
  'standings.column.form': 'Form',
  'standings.column.rank': '#',
  'standings.column.team': 'Team',
  'standings.column.played': 'P',
  'standings.column.wins': 'W',
  'standings.column.losses': 'L',
  'standings.column.for': 'F',
  'standings.column.against': 'A',
  'standings.column.diff': 'Diff',
  'standings.column.points': 'PTS',
  'standings.not_linked': 'This server is not linked to a league.',
  'standings.no_season': 'No season is in progress.',
  'standings.no_standings': 'The standings are not available yet.',
  'standings.unknownDivision': 'Unknown division. Divisions: {divisions}.',
  'standings.tooLong': 'The standings are too long for one message. Name a division: {divisions}.',
  'command.match.description': 'Match management, for staff only.',
  'command.match.result.description': 'Record or correct the result of a match.',
  'command.match.result.option.match':
    'The match: type a team, a division or a week (s3), then pick from the list.',
  'command.match.result.option.scoreA': 'Rounds won by the first team named.',
  'command.match.result.option.scoreB': 'Rounds won by the second team named.',
  'command.match.result.option.screenshot': 'Screenshot of the scoreboard (optional for staff).',
  'match.label': '{division} · W{week} · {teamA} – {teamB}',
  'match.labelWithResult': '{division} · W{week} · {teamA} {scoreA}–{scoreB} {teamB}',
  'match.result.recorded':
    'Result recorded: {division}, week {week}, {teamA} {scoreA}–{scoreB} {teamB}.',
  'match.result.corrected':
    'Result corrected: {division}, week {week}, {teamA} {scoreA}–{scoreB} {teamB} (was {previousA}–{previousB}).',
  'match.error.not_linked': 'This server is not linked to a league.',
  'match.error.not_staff': 'This command is for league staff only.',
  'match.error.match_not_found': 'No such match in this league. Pick it from the suggested list.',
  'match.error.match_closed':
    'This match is a forfeit or was annulled: its result cannot be changed here.',
  'match.error.unsupported_series':
    'This match is played over several maps; entering them one by one comes later.',
  'match.error.invalid_score': 'Invalid score: two different whole numbers, there are no draws.',
  'match.error.invalid_screenshot':
    'The screenshot must be a PNG, JPEG or WebP image under 20 MB, attached to the command.',
  'error.unknownCommand': 'Unknown command.',
  'error.unexpected': 'Something went wrong. Please try again in a moment.',
};
