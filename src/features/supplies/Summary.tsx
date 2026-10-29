import { fmtRange, sum } from "./money";
import type { Status, SupplyItem } from "./types";
import s from "./supplies.module.css";

const STATUS: Record<Status, string> = {
  live: "Na żywo",
  connecting: "Łączenie…",
  offline: "Brak połączenia — zmiany zapiszą się po odświeżeniu",
};

const money = ([lo, hi]: [number, number]) => (lo === 0 && hi === 0 ? "—" : fmtRange(lo, hi));

/** Sticky totals for the items in scope (active, non-archived) */
export default function Summary({ items, status }: { items: SupplyItem[]; status: Status }) {
  const done = items.filter((i) => i.checked);
  return (
    <>
      <div className={s.head}>
        <h1>Zapasy</h1>
        <span className={`${s.status} ${status === "live" ? s.live : ""}`} role="status">{STATUS[status]}</span>
      </div>
      <div className={s.stats}>
        <div className={s.stat}><span className="label">Kupione</span><b>{done.length} / {items.length}</b></div>
        <div className={s.stat}><span className="label">Wydane</span><b>{money(sum(done))}</b></div>
        <div className={s.stat}><span className="label">Zostało</span><b>{money(sum(items.filter((i) => !i.checked)))}</b></div>
      </div>
      <div className={s.bar} aria-hidden><i style={{ width: `${items.length ? (done.length / items.length) * 100 : 0}%` }} /></div>
    </>
  );
}
