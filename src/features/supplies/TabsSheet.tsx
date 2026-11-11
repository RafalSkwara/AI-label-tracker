import { useState } from "react";
import type { SupplyItem, SupplyTab, TabFields } from "./types";
import s from "./supplies.module.css";

type Props = {
  tabs: SupplyTab[];
  items: SupplyItem[];
  userId: string;
  shareInfo: (t: SupplyTab) => string;
  onShare: (t: SupplyTab) => void;
  onUpdate: (id: string, patch: TabFields) => void;
  onMove: (tab: SupplyTab, dir: -1 | 1) => void;
  onAdd: (name: string) => void;
  onClose: () => void;
};

/** Manage tabs: the owner renames, orders, archives and shares; a recipient sees whose tab it is and can open its sharing */
export default function TabsSheet({ tabs, items, userId, shareInfo, onShare, onUpdate, onMove, onAdd, onClose }: Props) {
  const [armed, setArmed] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const live = tabs.filter((t) => !t.archived);
  const own = live.filter((t) => t.owner_id === userId);
  const shared = live.filter((t) => t.owner_id !== userId);
  const archived = tabs.filter((t) => t.archived && t.owner_id === userId);
  const count = (id: string) => items.filter((i) => i.tab_id === id && !i.removed).length;

  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label="Podzakładki">
        <strong>Podzakładki</strong>
        {own.map((t, idx) => (
          <div key={t.id} className={s.tabrow}>
            <label className="field">Nazwa
              <input key={t.name} defaultValue={t.name} onBlur={(e) => {
                const v = e.target.value.trim();
                if (!v) e.target.value = t.name;
                else if (v !== t.name) onUpdate(t.id, { name: v });
              }} />
            </label>
            <label className="field">Opis
              <input key={t.description ?? ""} defaultValue={t.description ?? ""} onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== t.description) onUpdate(t.id, { description: v });
              }} />
            </label>
            <div className="ctl" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button className={s.icon} disabled={idx === 0} onClick={() => onMove(t, -1)} aria-label="Wyżej">↑</button>
              <button className={s.icon} disabled={idx === own.length - 1} onClick={() => onMove(t, 1)} aria-label="Niżej">↓</button>
              <button className="btn" onClick={() => onShare(t)}>👥 {shareInfo(t) || "Udostępnij"}</button>
              <button
                className={`btn danger ${armed === t.id ? "armed" : ""}`}
                onClick={() => {
                  const n = count(t.id);
                  if (n > 0 && armed !== t.id) return setArmed(t.id);
                  setArmed("");
                  onUpdate(t.id, { archived: true });
                }}
              >{armed === t.id ? `Archiwizuj z ${count(t.id)} pozycjami?` : "Archiwizuj"}</button>
            </div>
          </div>
        ))}
        {shared.length > 0 && <span className="label">Udostępnione Tobie</span>}
        {shared.map((t) => (
          <div key={t.id} className={s.tabrow}>
            <span>{t.name} <span className="sub">({count(t.id)}) · {shareInfo(t)}</span></span>
            <div><button className="btn" onClick={() => onShare(t)}>Kto ma dostęp</button></div>
          </div>
        ))}
        {archived.length > 0 && <span className="label">Zarchiwizowane</span>}
        {archived.map((t) => (
          <div key={t.id} className={s.tabrow}>
            <span>{t.name} <span className="sub">({count(t.id)})</span></span>
            <div><button className="btn" onClick={() => onUpdate(t.id, { archived: false })}>Przywróć</button></div>
          </div>
        ))}
        <form onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return setError("Podaj nazwę podzakładki.");
          onAdd(name.trim());
          setName(""); setError("");
        }} style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
          <label className="field">Nowa podzakładka<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          {error && <p className={s.err}>{error}</p>}
          <button className="btn primary" type="submit">Dodaj podzakładkę</button>
        </form>
        <button className="btn" onClick={onClose}>Zamknij</button>
      </div>
    </div>
  );
}
