// The player's replay folders (design doc section 8, upload flow 1): R6 keeps each lobby's rounds
// in a folder named after the lobby's start, `Match-2026-11-24_21-03-11-7400`, in the PC's own
// time, with one `Match-…-R01.rec` file per round. The page picks the folders recorded around the
// match, and the player can change the choice.

/** A file the browser gives: its path inside the folder picked, its name and size. */
export interface PickedFile {
  /** `webkitRelativePath`: `MatchReplay/Match-…/Match-…-R01.rec`. */
  path: string;
  name: string;
  size: number;
}

/** A date and time as written in a folder's name, in the PC's own time zone. */
export interface FolderTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface Recording<F extends PickedFile> {
  /** The folder's name. */
  folder: string;
  time: FolderTime | null;
  /** Round files, in round order. */
  files: F[];
}

const FOLDER_TIME = /^Match-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/;
const ROUND_FILE = /\.rec$/i;

export function folderTime(folder: string): FolderTime | null {
  const parts = FOLDER_TIME.exec(folder)?.slice(1).map(Number);
  if (!parts || parts.length !== 6) return null;
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = parts;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

/** The round files, grouped by the folder holding them; other files are left out. */
export function groupFolders<F extends PickedFile>(files: readonly F[]): Recording<F>[] {
  const folders = new Map<string, F[]>();
  for (const file of files) {
    if (!ROUND_FILE.test(file.name)) continue;
    const parts = (file.path || file.name).split('/');
    const folder = parts.length > 1 ? (parts[parts.length - 2] ?? '') : '';
    folders.set(folder, [...(folders.get(folder) ?? []), file]);
  }
  return [...folders.entries()]
    .map(([folder, list]) => ({
      folder,
      time: folderTime(folder),
      files: [...list].sort((x, y) => x.name.localeCompare(y.name, 'en', { numeric: true })),
    }))
    .sort((x, y) => y.folder.localeCompare(x.folder));
}

/** Whether a folder started inside the match's span: picked by default. */
export function inWindow(startedAt: number | null, window: { start: number; end: number }) {
  return startedAt !== null && startedAt >= window.start && startedAt <= window.end;
}
