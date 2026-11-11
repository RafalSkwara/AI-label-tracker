"use client";

import { useState } from "react";
import { type CalEvent, type Repeat, REMIND_OPTIONS, REPEAT_LABEL } from "@/lib/calendar";
import type { Calendar, EventFields } from "./data";
import s from "./calendar.module.css";

type Props = {
  event: CalEvent | null;
  day: string;
  calendars: Calendar[];
  defaultCalendar: string;
  onSave: (fields: EventFields) => void;
  onRemove: (ev: CalEvent) => void;
  onClose: () => void;
};

/** Add or edit one event; times are local */
export default function EventSheet({ event, day, calendars, defaultCalendar, onSave, onRemove, onClose }: Props) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [cal, setCal] = useState(event?.calendar_id ?? defaultCalendar);
  const [date, setDate] = useState(event?.starts_on ?? day);
  const [allDay, setAllDay] = useState(event ? !event.start_time : false);
  const [start, setStart] = useState(event?.start_time?.slice(0, 5) ?? "09:00");
  const [end, setEnd] = useState(event?.end_time?.slice(0, 5) ?? "");
  const [repeat, setRepeat] = useState<Repeat>(event?.repeat ?? "none");
  const [until, setUntil] = useState(event?.repeat_until ?? "");
  const [remind, setRemind] = useState<number | null>(event ? event.remind_minutes : 60);
  const [note, setNote] = useState(event?.note ?? "");
  const [error, setError] = useState("");
  const [armed, setArmed] = useState(false);

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Podaj nazwę wydarzenia.");
    if (!date) return setError("Podaj datę.");
    if (!allDay && end && end < start) return setError("Koniec nie może być przed początkiem.");
    if (repeat !== "none" && until && until < date) return setError("Koniec powtarzania nie może być przed datą wydarzenia.");
    onSave({
      calendar_id: cal, title: title.trim(), starts_on: date,
      start_time: allDay ? null : start, end_time: allDay || !end ? null : end,
      repeat, repeat_until: repeat === "none" || !until ? null : until,
      remind_minutes: remind, note: note.trim() || null,
    });
  }

  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label={event ? "Edytuj wydarzenie" : "Nowe wydarzenie"}>
        <strong>{event ? "Edytuj wydarzenie" : "Nowe wydarzenie"}</strong>
        <form onSubmit={save}>
          <label className="field wide">Nazwa<input autoFocus={!event} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="field">Data<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field">Kalendarz
            <select value={cal} onChange={(e) => setCal(e.target.value)}>
              {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className={`field check wide ${s.allday}`}><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />Cały dzień</label>
          {!allDay && <>
            <label className="field">Od<input type="time" required value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="field">Do<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
          </>}
          <label className="field">Powtarzanie
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
              {(Object.keys(REPEAT_LABEL) as Repeat[]).map((r) => <option key={r} value={r}>{REPEAT_LABEL[r]}</option>)}
            </select>
          </label>
          {repeat !== "none"
            ? <label className="field">Powtarzaj do<input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
            : <span />}
          <label className="field wide">Przypomnienie (push)
            <select value={remind ?? ""} onChange={(e) => setRemind(e.target.value === "" ? null : Number(e.target.value))}>
              {REMIND_OPTIONS.map((o) => <option key={o.l} value={o.v ?? ""}>{o.l}</option>)}
            </select>
          </label>
          <label className="field wide">Notatka<textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {error && <p className={`wide ${s.err}`} role="alert">{error}</p>}
          <div className="actions">
            {event ? (
              <button type="button" className={`btn danger ${armed ? "armed" : ""}`} onClick={() => { if (!armed) return setArmed(true); onRemove(event); }}>
                {armed ? (event.repeat !== "none" ? "Usunąć całą serię?" : "Na pewno?") : "Usuń"}
              </button>
            ) : <span />}
            <div>
              <button type="button" className="btn" onClick={onClose}>Anuluj</button>
              <button className="btn primary">Zapisz</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
