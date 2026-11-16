// Prints the mock standings, to check the data has every case the brief asks for.
import { standings } from '../_data/standings.ts';
import { matches } from '../_data/matches.ts';

for (const div of ['ligue-1', 'ligue-2']) {
  console.log(`\n${div}`);
  for (const r of standings(div)) {
    console.log(
      [
        r.excluded ? 'EX' : String(r.rank).padStart(2) + (r.shared ? '=' : ' '),
        r.change === null ? ' –' : r.change > 0 ? `+${r.change}` : r.change < 0 ? `${r.change}` : ' 0',
        r.team.tag.padEnd(5),
        r.played, r.wins, r.losses, r.roundsWon, r.roundsLost, r.diff, r.points,
        r.sanction ? `(${r.sanction})` : '',
        r.zone ?? '',
        r.form.map((f) => f.result + (f.forfeit ? '*' : '')).join(''),
      ].join('\t'),
    );
  }
}
const counts: Record<string, number> = {};
for (const m of matches) counts[m.status] = (counts[m.status] ?? 0) + 1;
console.log(counts);
console.log(matches.filter((m) => m.convertedFrom).map((m) => `${m.a.tag}-${m.b.tag} ${m.convertedFrom}`));
