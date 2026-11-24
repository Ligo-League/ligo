import { describe, expect, it } from 'vitest';
import { folderTime, groupFolders, inWindow } from './folders.ts';

const file = (path: string, size = 10) => ({ path, name: path.split('/').at(-1) ?? '', size });

describe('folderTime', () => {
  it('reads the time in a lobby folder’s name, and nothing else', () => {
    expect(folderTime('Match-2026-11-24_21-03-11-7400')).toEqual({
      year: 2026,
      month: 11,
      day: 24,
      hour: 21,
      minute: 3,
      second: 11,
    });
    expect(folderTime('Match-2026-13-24_21-03-11-7400')).toBeNull();
    expect(folderTime('Screenshots')).toBeNull();
  });
});

describe('groupFolders', () => {
  it('groups round files by folder, in round order, newest folder first', () => {
    const groups = groupFolders([
      file('MatchReplay/Match-2026-11-24_21-03-11-1/Match-2026-11-24_21-03-11-1-R10.rec'),
      file('MatchReplay/Match-2026-11-24_21-03-11-1/Match-2026-11-24_21-03-11-1-R02.rec'),
      file('MatchReplay/Match-2026-11-17_21-00-00-2/Match-2026-11-17_21-00-00-2-R01.rec'),
      file('MatchReplay/Match-2026-11-24_21-03-11-1/notes.txt'),
    ]);
    expect(groups.map((g) => [g.folder, g.files.map((f) => f.name.slice(-7))])).toEqual([
      ['Match-2026-11-24_21-03-11-1', ['R02.rec', 'R10.rec']],
      ['Match-2026-11-17_21-00-00-2', ['R01.rec']],
    ]);
  });
});

describe('inWindow', () => {
  it('picks a folder recorded inside the match’s span', () => {
    const window = { start: 100, end: 200 };
    expect(inWindow(150, window)).toBe(true);
    expect(inWindow(201, window)).toBe(false);
    expect(inWindow(null, window)).toBe(false);
  });
});
