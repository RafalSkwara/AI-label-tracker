// Calendar date math shared by the app and the Worker. Dates are "YYYY-MM-DD" and times "HH:MM[:SS]", local to Poland.

export type Repeat = "none" | "weekly" | "monthly" | "yearly";
export type CalEvent = {
  id: string;
  calendar_id: string;
  title: string;
  starts_on: string;
  start_time: string | null;
  end_time: string | null;
  repeat: Repeat;
  repeat_until: string | null;
  remind_minutes: number | null;
  note: string | null;
  updated_at: string;
};

export const TZ = "Europe/Warsaw";
/** All-day events are reminded as if they started at this local hour */
export const ALL_DAY_HOUR = 8;

const DAY = 864e5;
const parse = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fmtDate(parse(d) + n * DAY);
const daysIn = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const ymd = (y: number, m0: number, day: number) => fmtDate(Date.UTC(y, m0, Math.min(day, daysIn(y, m0))));

/** Dates in [from, to] on which the event happens (monthly/yearly on a missing day fall on the month's last day) */
export function occurrences(ev: Pick<CalEvent, "starts_on" | "repeat" | "repeat_until">, from: string, to: string): string[] {
  const start = ev.starts_on.slice(0, 10);
  const end = ev.repeat_until && ev.repeat_until < to ? ev.repeat_until : to;
  if (end < start || end < from) return [];
  if (ev.repeat === "none") return start >= from ? [start] : [];
  const out: string[] = [];
  if (ev.repeat === "weekly") {
    const skip = Math.max(0, Math.ceil((parse(from) - parse(start)) / (7 * DAY)));
    for (let d = addDays(start, skip * 7); d <= end; d = addDays(d, 7)) out.push(d);
    return out;
  }
  const sy = +start.slice(0, 4), sm = +start.slice(5, 7) - 1, sd = +start.slice(8, 10);
  const step = ev.repeat === "monthly" ? 1 : 12;
  let i = Math.max(0, Math.floor((((+from.slice(0, 4) - sy) * 12 + (+from.slice(5, 7) - 1 - sm)) / step)) - 1);
  for (;; i++) {
    const m = sm + i * step, d = ymd(sy + Math.floor(m / 12), ((m % 12) + 12) % 12, sd);
    if (d > end) break;
    if (d >= from && d >= start) out.push(d);
  }
  return out;
}

/** Offset of Poland from UTC at an instant, in ms */
function tzOffset(ms: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

/** Local date + time in Poland -> UTC ms */
export function localToUtc(date: string, time: string): number {
  const guess = parse(date) + (+time.slice(0, 2)) * 36e5 + (+time.slice(3, 5)) * 6e4;
  return guess - tzOffset(guess - tzOffset(guess));
}

/** Today in Poland */
export const localToday = (now = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(now);

/** When the reminder for one occurrence fires (UTC ms), or null without a reminder */
export function reminderAt(ev: Pick<CalEvent, "start_time" | "remind_minutes">, on: string): number | null {
  if (ev.remind_minutes == null) return null;
  const t = ev.start_time ?? `${String(ALL_DAY_HOUR).padStart(2, "0")}:00`;
  return localToUtc(on, t) - ev.remind_minutes * 6e4;
}

export const REMIND_OPTIONS: { v: number | null; l: string }[] = [
  { v: null, l: "Bez przypomnienia" }, { v: 0, l: "W chwili wydarzenia" }, { v: 15, l: "15 min przed" },
  { v: 60, l: "1 godz. przed" }, { v: 180, l: "3 godz. przed" }, { v: 1440, l: "1 dzień przed" }, { v: 2880, l: "2 dni przed" }, { v: 10080, l: "Tydzień przed" },
];
export const REPEAT_LABEL: Record<Repeat, string> = { none: "Nie powtarza się", weekly: "Co tydzień", monthly: "Co miesiąc", yearly: "Co rok" };

const WD = ["nd", "pn", "wt", "śr", "czw", "pt", "sob"];
export const hm = (t: string | null) => (t ? t.slice(0, 5) : "");
/** "śr 20.11" */
export const shortDay = (d: string) => `${WD[new Date(parse(d)).getUTCDay()]} ${d.slice(8, 10)}.${d.slice(5, 7)}`;
