"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTIVE, blocked, type Brand, checksOf, KIND_LABEL, type Kind, STATUS, type VideoJob } from "@/lib/video";
import { createCmv, loadJobs, syncNow } from "./data";
import JobSheet from "./JobSheet";
import s from "./video.module.css";

const BRAND_KEY = "video-brand";

/** "Wideo": create and run CMV / Slowfall videos; the pipeline on GitHub Actions does the work */
export default function VideoApp() {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [brand, setBrand] = useState<Brand>(() => { try { return (localStorage.getItem(BRAND_KEY) as Brand) || "cmv"; } catch { return "cmv"; } });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flash = useCallback((m: string) => { setToast(m); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(""), 3500); }, []);
  const reload = useCallback(async () => {
    try { setJobs(await loadJobs()); setError(""); } catch (e) { setError((e as Error).message); } finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    const onVis = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { document.removeEventListener("visibilitychange", onVis); clearTimeout(timer.current); };
  }, [reload]);

  // while something renders or uploads, refresh every 8 s
  const busy = jobs.some((j) => ACTIVE.includes(j.status));
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(reload, 8000);
    return () => clearInterval(t);
  }, [busy, reload]);

  const pickBrand = (b: Brand) => { setBrand(b); try { localStorage.setItem(BRAND_KEY, b); } catch {} };
  const replace = useCallback((j: VideoJob) => setJobs((all) => (all.some((x) => x.id === j.id) ? all.map((x) => (x.id === j.id ? j : x)) : [j, ...all])), []);
  const remove = useCallback((id: string) => { setJobs((all) => all.filter((x) => x.id !== id)); setOpen(null); }, []);

  const list = useMemo(() => {
    const own = jobs.filter((j) => j.brand === brand);
    // Slowfall: scenes in order, Shorts-only jobs next to their scene
    return brand === "slowfall" ? own.sort((a, b) => (a.slug ?? "").localeCompare(b.slug ?? "") || a.kind.localeCompare(b.kind)) : own;
  }, [jobs, brand]);
  const current = jobs.find((j) => j.id === open) ?? null;

  async function sync() {
    try { await syncNow(); flash("Synchronizacja ruszyła, wyniki za ok. minutę"); setTimeout(reload, 70_000); } catch (e) { flash(`Nie ruszyło: ${(e as Error).message}`); }
  }

  return (
    <main className={`wrap ${s.page}`}>
      <div className={s.head}>
        <h1>Wideo</h1>
        <span className={s.spacer} />
        <button className="btn" onClick={sync} title="Gotowość scen i stan na YouTube">Odśwież</button>
        {brand === "cmv" && <button className="btn primary" onClick={() => setCreating(true)}>+ Nowe</button>}
      </div>
      <div className="seg" role="tablist">
        {(["cmv", "slowfall"] as const).map((b) => (
          <a key={b} href="#" role="tab" aria-current={brand === b ? "page" : undefined} onClick={(e) => { e.preventDefault(); pickBrand(b); }}>
            {b === "cmv" ? "Contents May Vary" : "Slowfall Scenes"}
          </a>
        ))}
      </div>
      {error && <p className="banner">Nie udało się wczytać: {error}{/relation .*video_jobs/.test(error) ? " (migracja video_jobs nie jest jeszcze wgrana)" : ""}</p>}
      {loaded && !list.length && !error && (
        <p className="sub">{brand === "cmv" ? "Brak filmów. Dodaj pierwszy przyciskiem „+ Nowe”." : "Brak scen. Kliknij „Odśwież”: pipeline wczyta sceny z repozytorium."}</p>
      )}
      <ul className={s.list}>
        {list.map((j) => <JobCard key={j.id} job={j} onOpen={() => setOpen(j.id)} />)}
      </ul>
      {creating && <NewSheet onClose={() => setCreating(false)} onCreated={(j) => { replace(j); setCreating(false); setOpen(j.id); }} flash={flash} />}
      {current && <JobSheet job={current} onChange={replace} onRemoved={remove} onOpen={(j) => { replace(j); setOpen(j.id); }} onClose={() => setOpen(null)} flash={flash} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

function JobCard({ job, onOpen }: { job: VideoJob; onOpen: () => void }) {
  const st = STATUS[job.status];
  const checks = checksOf(job);
  const missing = blocked(job);
  const active = ACTIVE.includes(job.status);
  return (
    <li>
      <button className={`card ${s.card}`} onClick={onOpen}>
        <span className="t">{job.title}</span>
        <span className="meta">
          <span className="chip">{KIND_LABEL[job.kind]}</span>
          <span className={`chip ${st.tone}`}>{st.label}</span>
          {job.status === "draft" && checks.length > 0 && (
            <span className={`chip ${missing.length ? "late" : "ok"}`}>{missing.length ? `brakuje ${missing.length}` : "gotowe do startu"}</span>
          )}
          {job.slug && <span className="sub">{job.slug.slice(0, 2)}</span>}
        </span>
        {active && (
          <span className={s.prog}>
            <span className={s.bar}><span style={{ width: `${job.progress ?? 0}%` }} /></span>
            <span className="sub">{job.stage ?? "…"}{job.progress != null ? ` · ${job.progress} %` : ""}</span>
          </span>
        )}
        {job.status === "failed" && job.error && <span className={s.err}>{job.error.slice(0, 140)}</span>}
      </button>
    </li>
  );
}

function NewSheet({ onClose, onCreated, flash }: { onClose: () => void; onCreated: (j: VideoJob) => void; flash: (m: string) => void }) {
  const [kind, setKind] = useState<Kind>("lyric");
  const [song, setSong] = useState("");
  const [busy, setBusy] = useState(false);
  const kinds: { k: Kind; d: string }[] = [
    { k: "lyric", d: "Cała piosenka z tekstem, 16:9 w 4K (opcjonalnie też 9:16)" },
    { k: "short", d: "Wycinek piosenki 9:16 na Shorts / TikTok / Reels" },
    { k: "music_video", d: "Twoje klipy (Kling/MJ) cięte pod tekst, 16:9 w 4K" },
  ];
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!song.trim()) return;
    setBusy(true);
    try { onCreated(await createCmv(kind, song.trim())); } catch (err) { flash(`Nie zapisano: ${(err as Error).message}`); setBusy(false); }
  }
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-label="Nowe wideo CMV">
        <strong>Nowe wideo · Contents May Vary</strong>
        <form onSubmit={create}>
          <div className={`wide ${s.kinds}`} role="radiogroup">
            {kinds.map(({ k, d }) => (
              <button type="button" key={k} role="radio" aria-checked={kind === k} className={s.kind} onClick={() => setKind(k)}>
                <b>{KIND_LABEL[k]}</b><span className="sub">{d}</span>
              </button>
            ))}
          </div>
          <label className="field wide">Tytuł piosenki<input autoFocus maxLength={120} value={song} onChange={(e) => setSong(e.target.value)} placeholder="np. Do Not Disturb" /></label>
          <div className="actions"><button type="button" className="btn" onClick={onClose}>Anuluj</button><button className="btn primary" disabled={busy || !song.trim()}>Utwórz</button></div>
        </form>
      </div>
    </div>
  );
}
