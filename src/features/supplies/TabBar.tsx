import type { SupplyTab } from "./types";
import s from "./supplies.module.css";

export default function TabBar({ tabs, sel, onSel, onManage }: { tabs: SupplyTab[]; sel: string; onSel: (id: string) => void; onManage: () => void }) {
  return (
    <div className={s.chips} role="group" aria-label="Podzakładki">
      <button aria-pressed={sel === "all"} onClick={() => onSel("all")}>Wszystko</button>
      {tabs.map((t) => <button key={t.id} aria-pressed={sel === t.id} onClick={() => onSel(t.id)}>{t.name}</button>)}
      <button aria-label="Zarządzaj podzakładkami" onClick={onManage}>⋯</button>
    </div>
  );
}
