"use client";

import { useState } from "react";
import type { Calendar } from "./data";
import s from "./calendar.module.css";

type Props = {
  calendars: Calendar[];
  userId: string;
  hidden: Set<string>;
  shareInfo: (c: Calendar) => string;
  onToggle: (id: string) => void;
  onRename: (c: Calendar, name: string) => void;
  onColor: (c: Calendar, color: number) => void;
  onArchive: (c: Calendar) => void;
  onAdd: (name: string) => void;
  onShare: (c: Calendar) => void;
  onClose: () => void;
  /** dashboard users also see subscription payments (toggle id "subs") */
  showSubs: boolean;
};

export const COLORS = 6;

/** Calendars: show/hide, colour, rename, share (owner) or see who shared it (recipient) */
export default function CalendarsSheet({ calendars, userId, hidden, shareInfo, onToggle, onRename, onColor, onArchive, onAdd, onShare, onClose, showSubs }: Props) {
  const [name, setName] = useState("");
  const [armed, setArmed] = useState("");
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`sheet ${s.calsheet}`} role="dialog" aria-label="Kalendarze">
        <strong>Kalendarze</strong>
        {calendars.map((c) => {
          const own = c.owner_id === userId;
          return (
            <div key={c.id} className={s.calrow}>
              <label className={s.calvis}>
                <input type="checkbox" checked={!hidden.has(c.id)} onChange={() => onToggle(c.id)} aria-label={`Pokazuj: ${c.name}`} />
                <span className={s.swatch} data-c={c.color} />
              </label>
              {own
                ? <input className={s.calname} key={c.name} defaultValue={c.name} maxLength={60} aria-label="Nazwa kalendarza"
                    onBlur={(e) => { const v = e.target.value.trim(); if (!v) e.target.value = c.name; else if (v !== c.name) onRename(c, v); }} />
                : <span className={s.calname}>{c.name}</span>}
              <div className={s.calact}>
                {own && (
                  <span className={s.colors} role="group" aria-label="Kolor">
                    {Array.from({ length: COLORS }, (_, i) => (
                      <button key={i} className={s.swatch} data-c={i} aria-pressed={c.color === i} aria-label={`Kolor ${i + 1}`} onClick={() => onColor(c, i)} />
                    ))}
                  </span>
                )}
                <button className="btn" onClick={() => onShare(c)}>👥 {shareInfo(c) || "Udostępnij"}</button>
                {own && calendars.filter((x) => x.owner_id === userId).length > 1 && (
                  <button className={`btn danger ${armed === c.id ? "armed" : ""}`} onClick={() => { if (armed !== c.id) return setArmed(c.id); setArmed(""); onArchive(c); }}>
                    {armed === c.id ? "Na pewno?" : "Archiwizuj"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {showSubs && (
          <div className={s.calrow}>
            <label className={s.calvis}>
              <input type="checkbox" checked={!hidden.has("subs")} onChange={() => onToggle("subs")} aria-label="Pokazuj płatności za subskrypcje" />
              <span className={s.swatch} data-c="sub" />
            </label>
            <span className={s.calname}>Płatności za subskrypcje</span>
            <span className="sub">z Kanały → Koszty</span>
          </div>
        )}
        <form className={s.addcal} onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onAdd(name.trim()); setName(""); } }}>
          <input aria-label="Nowy kalendarz" placeholder="Nowy kalendarz, np. Rodzina" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" disabled={!name.trim()}>Dodaj</button>
        </form>
        <button className="btn" onClick={onClose}>Zamknij</button>
      </div>
    </div>
  );
}
