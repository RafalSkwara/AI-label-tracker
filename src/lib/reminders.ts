import type { Sub } from "./types";

/** Days before the payment date when a reminder goes out (0 = on the day) */
export const REMIND_DAYS = [3, 1, 0] as const;

export type Renewal = { sub: Pick<Sub, "id" | "name" | "price" | "currency">; days: number };

const dayMs = 864e5;
const when = (n: number) => (n === 0 ? "dziś" : n === 1 ? "jutro" : `za ${n} dni`);

/** Today's date in Poland (the cron runs in UTC), YYYY-MM-DD */
export const warsawToday = (now = new Date()) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(now);

/** Active subscriptions whose next payment (renew) is exactly 3, 1 or 0 days away */
export function dueRenewals(subs: Pick<Sub, "id" | "name" | "price" | "currency" | "status" | "renew">[], today: string): Renewal[] {
  const t = Date.parse(today);
  return subs
    .filter((s) => s.status === "aktywna" && s.renew)
    .map((s) => ({ sub: s, days: Math.round((Date.parse(s.renew!.slice(0, 10)) - t) / dayMs) }))
    .filter((r) => (REMIND_DAYS as readonly number[]).includes(r.days))
    .sort((a, b) => a.days - b.days || a.sub.name.localeCompare(b.sub.name, "pl"));
}

/** One notification for all due renewals of one user */
export function renewalMessage(due: Renewal[]): { title: string; body: string } {
  const money = (r: Renewal) => `${new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(r.sub.price) || 0)} ${r.sub.currency}`;
  if (due.length === 1) {
    const r = due[0];
    return { title: `Płatność ${when(r.days)}: ${r.sub.name}`, body: `${money(r)}. Dotknij, żeby sprawdzić lub anulować.` };
  }
  return { title: `Płatności za subskrypcje: ${due.length}`, body: due.map((r) => `${r.sub.name} ${when(r.days)} (${money(r)})`).join(", ") };
}
