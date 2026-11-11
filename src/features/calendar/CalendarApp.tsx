"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addShare, CALENDARS, loadShares, removeShare, type Shares, sharedLabel } from "@/features/sharing/data";
import PushToggle from "@/features/push/PushToggle";
import ShareSheet from "@/features/sharing/ShareSheet";
import { addDays, type CalEvent, hm, localToday, occurrences, REMIND_OPTIONS, shortDay } from "@/lib/calendar";
import CalendarsSheet from "./CalendarsSheet";
import { archiveCalendar, archiveEvent, type Calendar, type EventFields, insertCalendar, insertEvent, loadCalendar, type Renewal, updateCalendar, updateEvent } from "./data";
import EventSheet from "./EventSheet";
import s from "./calendar.module.css";

type Item = { key: string; day: string; title: string; time: string | null; end: string | null; color: number | null; ev?: CalEvent; renewal?: Renewal; cal?: string };

const MONTHS = ["Styczeń", "Luty", "Marzec", "Kwiecień", "Maj", "Czerwiec", "Lipiec", "Sierpień", "Wrzesień", "Październik", "Listopad", "Grudzień"];
const WEEK = ["pn", "wt", "śr", "cz", "pt", "so", "nd"];
const HIDE_KEY = "calendar-hidden";
const dayParam = () => { const d = new URLSearchParams(window.location.search).get("dzien"); return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null; };
const monthStart = (d: string) => d.slice(0, 8) + "01";
const monthEnd = (d: string) => addDays(addMonths(monthStart(d), 1), -1);
function addMonths(first: string, n: number) {
  const m = +first.slice(0, 4) * 12 + (+first.slice(5, 7) - 1) + n;
  return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`;
}
const weekday = (d: string) => (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7; // 0 = Monday

/** Calendar: month grid, the chosen day's events and what is coming up; own and shared calendars plus subscription payments */
export default function CalendarApp({ userId, email, dashboard }: { userId: string; email: string; dashboard: boolean }) {
  const router = useRouter();
  const today = localToday();
  const [day, setDay] = useState(() => dayParam() ?? today);
  const [month, setMonth] = useState(() => monthStart(dayParam() ?? today));
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [shares, setShares] = useState<Shares>({});
  const [hidden, setHidden] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(HIDE_KEY) ?? "[]")); } catch { return new Set(); } });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<CalEvent | "new" | null>(null);
  const [calsOpen, setCalsOpen] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seeded = useRef(false);

  const flash = useCallback((msg: string, undo?: () => void) => {
    setToast({ msg, undo });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), undo ? 6000 : 3200);
  }, []);
  const fail = useCallback((e: unknown) => flash(`Nie zapisano: ${(e as Error).message}`), [flash]);

  const reload = useCallback(async () => {
    try {
      const [d, sh] = await Promise.all([loadCalendar(dashboard), loadShares(CALENDARS)]);
      let cals = d.calendars;
      // first visit: every user gets one own calendar to start with
      if (!seeded.current && !cals.some((c) => c.owner_id === userId)) {
        seeded.current = true;
        cals = [...cals, await insertCalendar("Mój kalendarz", 0)];
      }
      setCalendars(cals); setEvents(d.events); setRenewals(d.renewals); setShares(sh); setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [dashboard, userId]);

  useEffect(() => {
    // initial load: setState happens after the awaited fetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    const onVis = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); clearTimeout(toastTimer.current); };
  }, [reload]);

  const calOf = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);

  /** Everything visible between two dates, sorted by day and time */
  const itemsIn = useCallback((from: string, to: string): Item[] => {
    const out: Item[] = [];
    for (const ev of events) {
      const c = calOf.get(ev.calendar_id);
      if (!c || hidden.has(c.id)) continue;
      for (const d of occurrences(ev, from, to)) out.push({ key: ev.id + d, day: d, title: ev.title, time: ev.start_time, end: ev.end_time, color: c.color, ev, cal: c.name });
    }
    if (!hidden.has("subs")) for (const r of renewals) if (r.renew >= from && r.renew <= to) out.push({ key: "sub" + r.id, day: r.renew, title: `Płatność: ${r.name}`, time: null, end: null, color: null, renewal: r });
    return out.sort((a, b) => a.day.localeCompare(b.day) || (a.time ?? "").localeCompare(b.time ?? ""));
  }, [events, renewals, calOf, hidden]);

  const gridFrom = addDays(month, -weekday(month));
  const gridTo = addDays(monthEnd(month), 6 - weekday(monthEnd(month)));
  const gridItems = useMemo(() => itemsIn(gridFrom, gridTo), [itemsIn, gridFrom, gridTo]);
  const byDay = useMemo(() => { const m = new Map<string, Item[]>(); for (const i of gridItems) m.set(i.day, [...(m.get(i.day) ?? []), i]); return m; }, [gridItems]);
  const days: string[] = [];
  for (let d = gridFrom; d <= gridTo; d = addDays(d, 1)) days.push(d);
  const dayItems = itemsIn(day, day);
  const soon = itemsIn(addDays(today, 1), addDays(today, 30)).filter((i) => i.day !== day).slice(0, 8);

  function pick(d: string) {
    setDay(d);
    if (monthStart(d) !== month) setMonth(monthStart(d));
    const u = new URL(window.location.href);
    u.searchParams.set("dzien", d);
    history.replaceState(null, "", u);
  }
  const go = (n: number) => { const m = addMonths(month, n); setMonth(m); pick(m.slice(0, 7) === today.slice(0, 7) ? today : m); };

  function toggle(id: string) {
    setHidden((h) => {
      const n = new Set(h);
      if (!n.delete(id)) n.add(id);
      try { localStorage.setItem(HIDE_KEY, JSON.stringify([...n])); } catch { /* storage unavailable */ }
      return n;
    });
  }

  async function save(f: EventFields) {
    const prev = sheet;
    setSheet(null);
    try {
      if (prev && prev !== "new") { const ev = await updateEvent(prev.id, f); setEvents((l) => l.map((x) => (x.id === ev.id ? ev : x))); }
      else { const ev = await insertEvent(f); setEvents((l) => [...l, ev]); pick(ev.starts_on); }
      flash("Zapisano");
    } catch (e) { fail(e); }
  }

  async function remove(ev: CalEvent) {
    setSheet(null);
    try {
      await archiveEvent(ev.id);
      setEvents((l) => l.filter((x) => x.id !== ev.id));
      flash(`Usunięto: ${ev.title}`, async () => {
        setToast(null);
        try { const back = await archiveEvent(ev.id, false); setEvents((l) => [...l, back]); } catch (e) { fail(e); }
      });
    } catch (e) { fail(e); }
  }

  async function patchCal(c: Calendar, patch: Partial<Pick<Calendar, "name" | "color">>) {
    setCalendars((l) => l.map((x) => (x.id === c.id ? { ...x, ...patch } : x)));
    try { const row = await updateCalendar(c.id, patch); setCalendars((l) => l.map((x) => (x.id === c.id ? row : x))); }
    catch (e) { setCalendars((l) => l.map((x) => (x.id === c.id ? c : x))); fail(e); }
  }
  async function addCal(name: string) {
    try { const c = await insertCalendar(name, calendars.length % 6); setCalendars((l) => [...l, c]); } catch (e) { fail(e); }
  }
  async function archiveCal(c: Calendar) {
    try { await archiveCalendar(c.id); setCalendars((l) => l.filter((x) => x.id !== c.id)); flash(`Kalendarz „${c.name}” w archiwum`); } catch (e) { fail(e); }
  }

  const shareInfo = (c: Calendar) => c.owner_id !== userId
    ? `od ${c.owner_email ?? "innej osoby"}`
    : (shares[c.id]?.length ? sharedLabel(shares[c.id].length, "Udostępniony") : "");
  const sharingCal = sharing ? calOf.get(sharing) : undefined;
  const writable = calendars.filter((c) => !hidden.has(c.id));
  const defaultCal = (writable.find((c) => c.owner_id === userId) ?? writable[0] ?? calendars[0])?.id ?? "";

  if (!loaded) return <div className="wrap"><p className="sub">Wczytywanie…</p></div>;

  const row = (i: Item, showDay: boolean) => (
    <li key={i.key}>
      <button className={s.item} onClick={() => (i.ev ? setSheet(i.ev) : router.push("/dashboard?tab=koszty"))}>
        <span className={s.bar} data-c={i.color ?? "sub"} />
        <span className={s.when}>{showDay && <span>{shortDay(i.day)}</span>}<span>{i.time ? hm(i.time) + (i.end ? `–${hm(i.end)}` : "") : "cały dzień"}</span></span>
        <span className={s.what}>
          <span className={s.title}>{i.title}</span>
          <span className="sub">{i.renewal ? "subskrypcja" : [i.cal, i.ev?.repeat !== "none" ? "↻" : "", i.ev?.remind_minutes != null ? `🔔 ${REMIND_OPTIONS.find((o) => o.v === i.ev!.remind_minutes)?.l ?? ""}` : ""].filter(Boolean).join(" · ")}</span>
        </span>
      </button>
    </li>
  );

  return (
    <main className={s.page}>
      <div className={s.head}>
        <button className={s.nav} onClick={() => go(-1)} aria-label="Poprzedni miesiąc">‹</button>
        <h1 className={s.month}>{MONTHS[+month.slice(5, 7) - 1]} {month.slice(0, 4)}</h1>
        <button className={s.nav} onClick={() => go(1)} aria-label="Następny miesiąc">›</button>
        <span className={s.spacer} />
        {day !== today && <button className="btn" onClick={() => pick(today)}>Dziś</button>}
        <button className={s.nav} onClick={() => setCalsOpen(true)} aria-label="Kalendarze">⋯</button>
      </div>

      {error && <div className="banner"><span>{error}</span><button className="btn" onClick={reload}>Spróbuj ponownie</button></div>}

      <div className={s.grid} role="grid" aria-label="Miesiąc">
        {WEEK.map((w) => <span key={w} className={s.wd}>{w}</span>)}
        {days.map((d) => {
          const its = byDay.get(d) ?? [];
          return (
            <button key={d} className={s.cell} data-out={d.slice(0, 7) !== month.slice(0, 7)} data-today={d === today} aria-pressed={d === day}
              onClick={() => pick(d)} aria-label={`${shortDay(d)}${its.length ? `, wydarzenia: ${its.length}` : ""}`}>
              <span className={s.num}>{+d.slice(8, 10)}</span>
              <span className={s.dots}>{its.slice(0, 3).map((i) => <span key={i.key} className={s.dot} data-c={i.color ?? "sub"} />)}</span>
            </button>
          );
        })}
      </div>

      <section aria-label={`Wydarzenia: ${shortDay(day)}`}>
        <div className={s.dayhead}>
          <h2>{day === today ? "Dziś" : shortDay(day)}</h2>
          <button className="btn primary" onClick={() => setSheet("new")} disabled={!calendars.length}>+ Wydarzenie</button>
        </div>
        {dayItems.length ? <ul className={s.list}>{dayItems.map((i) => row(i, false))}</ul> : <p className="sub">Nic zaplanowanego.</p>}
      </section>

      {soon.length > 0 && (
        <section aria-label="Wkrótce">
          <h2 className={s.soon}>Wkrótce</h2>
          <ul className={s.list}>{soon.map((i) => row(i, true))}</ul>
        </section>
      )}

      <PushToggle flash={(m) => flash(m)} title="Powiadomienia na tym urządzeniu" on="Włączone: przypomnienia z wydarzeń przychodzą jako push." off="Włącz, żeby dostawać przypomnienia ustawione w wydarzeniach." />

      {sheet && (
        <EventSheet event={sheet === "new" ? null : sheet} day={day} calendars={calendars} defaultCalendar={sheet === "new" ? defaultCal : sheet.calendar_id}
          onSave={save} onRemove={remove} onClose={() => setSheet(null)} />
      )}
      {calsOpen && (
        <CalendarsSheet calendars={calendars} userId={userId} hidden={hidden} shareInfo={shareInfo} onToggle={toggle}
          onRename={(c, name) => patchCal(c, { name })} onColor={(c, color) => patchCal(c, { color })} onArchive={archiveCal} onAdd={addCal}
          onShare={(c) => { setCalsOpen(false); setSharing(c.id); }} onClose={() => setCalsOpen(false)}
          showSubs={dashboard} />
      )}
      {sharingCal && (
        <ShareSheet
          what={`kalendarz „${sharingCal.name}”`}
          emails={(shares[sharingCal.id] ?? []).filter((m) => m !== email)}
          owner={sharingCal.owner_id === userId}
          ownerEmail={sharingCal.owner_email}
          onAdd={async (m) => { await addShare(CALENDARS, sharingCal.id, m); setShares((sh) => ({ ...sh, [sharingCal.id]: [...(sh[sharingCal.id] ?? []), m] })); flash(`Udostępniono: ${m}`); }}
          onRemove={async (m) => { await removeShare(CALENDARS, sharingCal.id, m); setShares((sh) => ({ ...sh, [sharingCal.id]: (sh[sharingCal.id] ?? []).filter((x) => x !== m) })); }}
          onLeave={async () => { await removeShare(CALENDARS, sharingCal.id, email); setSharing(null); setCalendars((l) => l.filter((c) => c.id !== sharingCal.id)); setEvents((l) => l.filter((e) => e.calendar_id !== sharingCal.id)); flash(`Opuszczono „${sharingCal.name}”`); }}
          onClose={() => setSharing(null)}
        />
      )}
      {toast && (
        <div className={`toast ${s.toast}`} role="status">
          <span>{toast.msg}</span>
          {toast.undo && <button className={s.undo} onClick={toast.undo}>Cofnij</button>}
        </div>
      )}
    </main>
  );
}
