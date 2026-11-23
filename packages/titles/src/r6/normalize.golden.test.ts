import { describe, expect, it } from 'vitest';
import clutch1v3 from './golden/clutch-1v3.round.json' with { type: 'json' };
import deathEvent from './golden/death-event.round.json' with { type: 'json' };
import defusedBomb from './golden/defused-bomb.round.json' with { type: 'json' };
import empty4v5 from './golden/empty-4v5.round.json' with { type: 'json' };
import interrupted from './golden/interrupted.round.json' with { type: 'json' };
import noWinCondition from './golden/no-win-condition.round.json' with { type: 'json' };
import onlineDisabledDefuser from './golden/online-disabled-defuser.round.json' with { type: 'json' };
import teamKill from './golden/team-kill.round.json' with { type: 'json' };
import timeClutch1v2 from './golden/time-clutch-1v2.round.json' with { type: 'json' };
import { normalizeR6, type R6Unit } from './normalize.ts';

// Golden files (design doc section 14): real rounds of the r6-dissect fork's JSON, from the pro
// replays of `pnpm fixtures:replays` (golden/README.md says which), and what the normaliser makes
// of them. A change to either output shows in review; the facts below were checked by hand
// against each round's feed.

const CTX = { parser: 'r6-golden', fileSha256: '00'.repeat(32), tradeWindowS: 10 };
const ROUNDS: Record<string, unknown> = {
  'clutch-1v3': clutch1v3,
  'death-event': deathEvent,
  'defused-bomb': defusedBomb,
  'empty-4v5': empty4v5,
  interrupted,
  'no-win-condition': noWinCondition,
  'online-disabled-defuser': onlineDisabledDefuser,
  'team-kill': teamKill,
  'time-clutch-1v2': timeClutch1v2,
};

function normalized(name: string): R6Unit {
  const result = normalizeR6(ROUNDS[name], CTX);
  if (!result.ok) throw new Error(`${name}: ${result.message}`);
  return result.unit;
}
const byName = (unit: R6Unit, name: string) => unit.players.find((p) => p.name === name);

describe('normalizeR6 on real rounds', () => {
  it.each(Object.keys(ROUNDS))('%s matches its golden file, without warnings', async (name) => {
    const unit = normalized(name);
    expect(unit.warnings).toEqual([]);
    await expect(`${JSON.stringify(unit, null, 2)}\n`).toMatchFileSnapshot(
      `golden/${name}.unit.json`,
    );
  });

  it('team-kill: no kill for the team kill, two trades, planted from the disabled defuser', () => {
    const unit = normalized('team-kill');
    expect(unit.planted).toBe(true);
    expect(byName(unit, 'Mowwwgli.Twis')?.stats).toMatchObject({ kills: 1, traded_deaths: 1 });
    expect(byName(unit, 'Hashom.Twis')?.stats).toMatchObject({ deaths: 1, traded_deaths: 0 });
    expect(byName(unit, 'Robby.SHFT')?.stats).toMatchObject({ traded_deaths: 1 });
    expect(byName(unit, 'Freq.SHFT')?.stats).toMatchObject({ trade_kills: 1 });
    expect(byName(unit, 'BlaZ.Twis')?.stats).toMatchObject({ opening_kills: 1, trade_kills: 1 });
    expect(byName(unit, 'CTZN.SHFT')?.stats.opening_deaths).toBe(1);
  });

  it('online rounds carry profileIDs; LAN rounds zero them', () => {
    expect(normalized('online-disabled-defuser').players.every((p) => p.account !== null)).toBe(
      true,
    );
    expect(normalized('empty-4v5').players.every((p) => p.account === null)).toBe(true);
  });

  it('clutches: a 1v2 won on time, a 1v3 won', () => {
    const clutchOf = (unit: R6Unit) =>
      unit.players
        .filter((p) => p.stats.clutch_wins === 1)
        .map((p) => ({ side: p.side, vs: p.detail.clutch_vs }));
    const onTime = normalized('time-clutch-1v2');
    expect(onTime.sides.find((s) => s.won)?.win_condition).toBe('Time');
    expect(clutchOf(onTime)).toEqual([{ side: expect.any(Number) as number, vs: 2 }]);
    expect(clutchOf(normalized('clutch-1v3'))).toEqual([
      { side: expect.any(Number) as number, vs: 3 },
    ]);
  });

  it('rounds that never ended, or ended without a stated condition', () => {
    expect(normalized('interrupted').complete).toBe(false);
    const empty = normalized('empty-4v5');
    expect(empty).toMatchObject({ complete: false, events: [] });
    expect(empty.players).toHaveLength(9);
    expect(empty.players.every((p) => p.stats.rounds_survived === 1)).toBe(true);
    const unstated = normalized('no-win-condition');
    expect(unstated.complete).toBe(true);
    expect(unstated.sides.find((s) => s.won)?.win_condition).toBeNull();
  });

  it('a Death event, and a defuser that went off', () => {
    const unit = normalized('death-event');
    const death = unit.events.find((e) => e.type === 'death');
    if (death?.type !== 'death' || death.target === null) throw new Error('no Death event');
    expect(unit.players[death.target]?.stats).toMatchObject({ deaths: 1, opening_deaths: 1 });
    expect(normalized('defused-bomb')).toMatchObject({ planted: true });
  });
});
