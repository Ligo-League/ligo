// Formatting shared by every proposal: Europe/Paris times with the zone's short name, French
// numbers. The website will use the same rules (CLAUDE.md: store UTC ms, display Europe/Paris).

export const TIME_ZONE = 'Europe/Paris';

/** The mock "now": Thursday 26 November 2026, 20:40 CET (week 6). */
export const NOW = Date.UTC(2026, 10, 26, 19, 40);

/** Paris wall-clock time to UTC ms. CET is UTC+1 before 29 March and after 25 October 2026/2027. */
export function paris(y: number, m: number, d: number, hh = 0, mm = 0): number {
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  return naive - offsetHours(naive) * 3_600_000;
}

/** 1 or 2: Paris's offset from UTC at that instant (DST rule of the EU). */
export function offsetHours(at: number): number {
  const d = new Date(at);
  const y = d.getUTCFullYear();
  const lastSunday = (month: number) => {
    const last = new Date(Date.UTC(y, month + 1, 0));
    return Date.UTC(y, month, last.getUTCDate() - last.getUTCDay(), 1); // 01:00 UTC
  };
  return at >= lastSunday(2) && at < lastSunday(9) ? 2 : 1;
}

export const zoneName = (at: number): string => (offsetHours(at) === 2 ? 'CEST' : 'CET');

const fmt = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: TIME_ZONE, ...opts });

const weekdayShort = fmt({ weekday: 'short' });
const dayMonth = fmt({ day: 'numeric', month: 'short' });
const dayMonthLong = fmt({ day: 'numeric', month: 'long' });
const dayMonthYear = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const hourMinute = fmt({ hour: '2-digit', minute: '2-digit' });
const weekdayLong = fmt({ weekday: 'long' });

/** "21:00" */
export const time = (at: number): string => hourMinute.format(at);
/** "21:00 CET" */
export const timeZ = (at: number): string => `${time(at)} ${zoneName(at)}`;
/** "jeu. 26 nov." */
export const day = (at: number): string => `${weekdayShort.format(at)} ${dayMonth.format(at)}`;
/** "jeu. 26 nov. · 21:00 CET" */
export const when = (at: number): string => `${day(at)} · ${timeZ(at)}`;
/** "26 nov." */
export const dateShort = (at: number): string => dayMonth.format(at);
/** "26 novembre" */
export const dateLong = (at: number): string => dayMonthLong.format(at);
/** "26 nov. 2026" */
export const dateYear = (at: number): string => dayMonthYear.format(at);
/** "jeudi" */
export const weekday = (at: number): string => weekdayLong.format(at);

/** "il y a 2 h", "dans 20 min", relative to NOW. */
export function relative(at: number, now = NOW): string {
  const minutes = Math.round((at - now) / 60_000);
  const abs = Math.abs(minutes);
  const unit =
    abs < 60 ? `${abs} min` : abs < 60 * 24 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} j`;
  return minutes >= 0 ? `dans ${unit}` : `il y a ${unit}`;
}

/** Same Paris calendar day. */
export const sameDay = (a: number, b: number): boolean =>
  fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(a) ===
  fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).format(b);

const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** "1,18" */
export const ratio = (n: number | null): string => (n === null ? '–' : nf2.format(n));
/** "6,4" */
export const dec1 = (n: number | null): string => (n === null ? '–' : nf1.format(n));
/** "54 %" with a narrow no-break space, as French typography wants. */
export const pct = (n: number | null): string => (n === null ? '–' : `${nf0.format(n * 100)} %`);
/** "+14", "−3", "0" with a real minus sign. */
export const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
export const int = (n: number): string => nf0.format(n);
