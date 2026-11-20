"use client";

import { useRef, useState } from "react";
import {
  ACTIVE, type Asset, blocked, checksOf, cleanStyle, FONTS, gb, KIND_LABEL, LAYOUTS, type Meta, mmss, type Params, parseMmss,
  presetStyle, PRESETS, type Privacy, STATUS, type Style, type VideoJob,
} from "@/lib/video";
import { action, applyInstructions, download, saveJob, shortsFor, upload } from "./data";
import s from "./video.module.css";

type Props = {
  job: VideoJob;
  onChange: (j: VideoJob) => void;
  onRemoved: (id: string) => void;
  onOpen: (j: VideoJob) => void;
  onClose: () => void;
  flash: (m: string) => void;
};

const localInput = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);
};
const nextSlot = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(18, 0, 0, 0); return d.toISOString(); };
const ytUrl = (id: string) => `https://youtu.be/${id}`;
const YT_LABEL: Record<string, string> = { private: "prywatne", scheduled: "zaplanowane", public: "publiczne", unlisted: "niepubliczne", removed: "usunięte z YT" };

/** One video job: inputs and look (CMV), readiness (Slowfall), run status, files, publishing */
export default function JobSheet({ job, onChange, onRemoved, onOpen, onClose, flash }: Props) {
  const cmv = job.brand === "cmv";
  const active = ACTIVE.includes(job.status);
  const [title, setTitle] = useState(job.title);
  const [params, setParams] = useState<Params>(job.params);
  const [meta, setMeta] = useState<Meta>({ privacy: "scheduled", ...job.meta });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [armed, setArmed] = useState(false);
  const [more, setMore] = useState(false);
  const style: Style = params.style ?? presetStyle(params.preset ?? "night", job.kind);

  const touched = useRef(new Set<keyof Params>());
  const setP = (p: Partial<Params>) => { Object.keys(p).forEach((k) => touched.current.add(k as keyof Params)); setParams((x) => ({ ...x, ...p })); setDirty(true); };
  const setS = (p: Partial<Style>) => setP({ style: { ...style, ...p } });
  const setM = (p: Partial<Meta>) => { setMeta((x) => ({ ...x, ...p })); setDirty(true); };

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    try { return await fn(); } catch (e) { flash(`${label}: ${(e as Error).message}`); } finally { setBusy(""); }
  }
  const save = async () => {
    if (!dirty) return job;
    // only the fields edited here: the pipeline also writes params (e.g. the alignment score)
    const edited = Object.fromEntries([...touched.current].map((k) => [k, params[k]]));
    const j = await saveJob(job.id, { title: title.trim() || job.title, params: { ...job.params, ...edited }, meta });
    touched.current.clear();
    onChange(j); setDirty(false);
    return j;
  };
  const act = async (label: string, name: string, extra: Record<string, unknown> = {}) => {
    const j = await run(label, async () => { await save(); return action(job.id, name, extra); });
    if (j && "id" in j) onChange(j);
    return j;
  };

  const missing = blocked(job);
  const files = job.outputs.filter((o) => o.key && !o.removed_at);
  const onYt = job.outputs.filter((o) => o.video_id);
  const canPublish = !active && (files.length > 0 || onYt.some((o) => o.yt_status !== "removed"));
  const st = STATUS[job.status];

  async function onFile(role: Asset["role"], list: FileList | null) {
    if (!list?.length) return;
    for (const f of Array.from(list)) {
      const j = await run(`Wysyłanie ${f.name}`, () => upload(job.id, role, f));
      if (j) onChange(j);
    }
  }

  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) { save().catch(() => {}); onClose(); } }}>
      <div className={`sheet ${s.sheet}`} role="dialog" aria-label={job.title}>
        <div className={s.top}>
          <div style={{ minWidth: 0 }}>
            <div className="sub">{KIND_LABEL[job.kind]}{job.slug ? ` · ${job.slug}` : ""}</div>
            {cmv ? <input className={s.title} value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); setDirty(true); }} aria-label="Nazwa" /> : <strong>{job.title}</strong>}
          </div>
          <span className={`chip ${st.tone}`}>{st.label}</span>
        </div>

        {active && (
          <section className={s.box}>
            <div className={s.bar}><span style={{ width: `${job.progress ?? 0}%` }} /></div>
            <div className={s.row}>
              <span className="sub">{job.stage ?? "Start"}{job.progress != null ? ` · ${job.progress} %` : ""}</span>
              {job.run_url && <a href={job.run_url} target="_blank" rel="noopener noreferrer">log ↗</a>}
            </div>
            <button className="btn danger" disabled={!!busy} onClick={() => act("Zatrzymanie", "cancel")}>Zatrzymaj</button>
          </section>
        )}
        {job.status === "failed" && job.error && (
          <p className={`banner ${s.errbox}`}>{job.error}{job.run_url && <> · <a href={job.run_url} target="_blank" rel="noopener noreferrer">log ↗</a></>}</p>
        )}

        {cmv && (
          <section className={s.box}>
            <h2>Pliki</h2>
            <FileRow label="Piosenka (MP3/WAV)" accept="audio/*,.mp3,.wav,.m4a,.flac" role="audio" job={job} onFile={onFile} onRemove={(a) => act("Usuwanie", "remove-asset", { key: a.key })} busy={!!busy} />
            {job.kind === "music_video"
              ? <FileRow label="Klipy (MP4, kolejność = kolejność cięć)" accept="video/*" role="clip" multiple job={job} onFile={onFile} onRemove={(a) => act("Usuwanie", "remove-asset", { key: a.key })} busy={!!busy} />
              : <FileRow label="Tło: obraz albo wideo (opcjonalnie)" accept="image/*,video/*" role="background" job={job} onFile={onFile} onRemove={(a) => act("Usuwanie", "remove-asset", { key: a.key })} busy={!!busy} />}
            {busy.startsWith("Wysyłanie") && <p className="sub">{busy}…</p>}
          </section>
        )}

        {cmv && (
          <section className={s.box}>
            <h2>Tekst</h2>
            <div className={s.two}>
              <label className="field">Tytuł piosenki<input value={params.song ?? ""} onChange={(e) => setP({ song: e.target.value })} /></label>
              <label className="field">Wykonawca<input value={params.artist ?? ""} onChange={(e) => setP({ artist: e.target.value })} /></label>
            </div>
            <label className="field">Tekst z sekcjami ([Verse 1], [Chorus]…)
              <textarea rows={6} value={params.lyrics ?? ""} onChange={(e) => setP({ lyrics: e.target.value, realign: true })} placeholder={"[Verse 1]\nPierwsza linijka\n…\n[Chorus]\n…"} />
            </label>
            {params.matched != null && <p className="sub">Ostatnie dopasowanie: {Math.round(params.matched * 100)} % słów trafionych z nagrania{params.matched < 0.7 ? " (słabo: sprawdź tekst)" : ""}.</p>}
            <FileRow label="Gotowe timingi JSON (opcjonalnie, pomija dopasowanie)" accept=".json,application/json" role="timing" job={job} onFile={onFile} onRemove={(a) => act("Usuwanie", "remove-asset", { key: a.key })} busy={!!busy} />
          </section>
        )}

        {cmv && (
          <section className={s.box}>
            <h2>Wygląd</h2>
            <div className={s.presets}>
              {Object.entries(PRESETS).map(([k, p]) => (
                <button key={k} className={s.preset} aria-pressed={params.preset === k} onClick={() => setP({ preset: k, style: { ...presetStyle(k, job.kind), badge: style.badge } })}
                  style={{ background: `linear-gradient(135deg, ${p.style.bg1}, ${p.style.bg2})`, color: p.style.textColor }}>
                  <span style={{ color: p.style.accent }}>●</span> {p.label}
                </button>
              ))}
            </div>
            <label className="field">Instrukcje (co ma być inaczej)
              <textarea rows={3} value={params.instructions ?? ""} onChange={(e) => setP({ instructions: e.target.value })} placeholder="np. agresywnie, czerwień i czerń, duże litery, mocny glitch w refrenie, bez paska postępu" />
            </label>
            <div className={s.row}>
              <button className="btn" disabled={!!busy || !params.instructions?.trim()} onClick={async () => {
                const r = await run("AI", () => applyInstructions(params.instructions!, style, job.kind));
                if (r) { setP({ style: r.style }); setNote(r.note || "Zastosowano."); }
              }}>{busy === "AI" ? "Czytam…" : "Zastosuj instrukcje (AI)"}</button>
              <button className="btn" onClick={() => setMore((v) => !v)} aria-expanded={more}>{more ? "Mniej" : "Szczegóły"}</button>
            </div>
            {note && <p className="sub">{note}</p>}
            {more && <StyleFields style={style} set={setS} />}
            {job.kind === "lyric" && (
              <label className="field check"><input type="checkbox" checked={(params.formats ?? ["16:9"]).includes("9:16")} onChange={(e) => setP({ formats: e.target.checked ? ["16:9", "9:16"] : ["16:9"] })} />Także wersja pionowa 9:16 (1080p)</label>
            )}
            {job.kind === "music_video" && (
              <label className="field check"><input type="checkbox" checked={params.show_lyrics !== false} onChange={(e) => setP({ show_lyrics: e.target.checked })} />Tekst na teledysku</label>
            )}
            {job.kind === "short" && <Segment params={params} setP={setP} />}
          </section>
        )}

        <section className={s.box}>
          <h2>{cmv ? "Render" : "Gotowość sceny"}</h2>
          <ul className={s.checks}>
            {checksOf(job).map((c) => (
              <li key={c.key} data-ok={c.ok} data-opt={c.required === false}>
                <span aria-hidden="true">{c.ok ? "✓" : c.required === false ? "○" : "✕"}</span>
                <span>{c.label}{!c.ok && c.hint && <span className="sub"> · {c.hint}</span>}</span>
              </li>
            ))}
            {!checksOf(job).length && <li className="sub">Brak danych o scenie: kliknij „Odśwież” na liście.</li>}
          </ul>
          {!active && (cmv || job.outputs.length === 0 || job.kind === "sf_shorts") && (
            <div className={s.row}>
              <button className="btn primary" disabled={!!busy || missing.length > 0} onClick={() => act("Start", "render")}>
                {cmv ? (files.length ? "Renderuj ponownie" : "Renderuj") : job.kind === "sf_shorts" ? "Zbuduj Shorty" : "Zbuduj film + 3 Shorty"}
              </button>
              {cmv && <span className="sub">{job.kind === "short" ? "~5 min" : "16:9 w 4K: ~30 min"} na GitHub Actions</span>}
            </div>
          )}
          {!cmv && job.kind === "sf_long" && !active && (
            <button className="btn" disabled={!!busy || missing.length > 0} onClick={async () => { const j = await run("Shorty", () => shortsFor(job)); if (j) onOpen(j); }}>Tylko Shorty z tej sceny…</button>
          )}
        </section>

        {(files.length > 0 || onYt.length > 0) && (
          <section className={s.box}>
            <h2>Gotowe pliki</h2>
            <ul className={s.outs}>
              {job.outputs.map((o, i) => (
                <li key={o.key ?? o.video_id ?? i}>
                  <span>{o.label}{o.size ? ` · ${gb(o.size)}` : ""}</span>
                  <span className={s.row}>
                    {o.video_id && <a href={ytUrl(o.video_id)} target="_blank" rel="noopener noreferrer">YT{o.yt_status ? ` · ${YT_LABEL[o.yt_status] ?? o.yt_status}` : ""} ↗</a>}
                    {o.key && !o.removed_at && <button className="btn" disabled={!!busy} onClick={() => run("Pobieranie", () => download(job.id, o.key!))}>Pobierz</button>}
                    {o.key && !o.removed_at && <button className="btn danger" disabled={!!busy || active} onClick={() => act("Usuwanie z chmury", "clean", { keys: [o.key] })}>Usuń z chmury</button>}
                    {o.removed_at && <span className="sub">usunięty z chmury</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {canPublish && (
          <section className={s.box}>
            <h2>Publikacja na YouTube</h2>
            <label className="field">Tytuł<input maxLength={100} value={meta.title ?? ""} onChange={(e) => setM({ title: e.target.value })} /></label>
            <label className="field">Opis<textarea rows={4} value={meta.description ?? ""} onChange={(e) => setM({ description: e.target.value })} /></label>
            <label className="field">Tagi (po przecinku)<input value={(meta.tags ?? []).join(", ")} onChange={(e) => setM({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} /></label>
            <div className={s.two}>
              <label className="field">Widoczność
                <select value={meta.privacy ?? "scheduled"} onChange={(e) => setM({ privacy: e.target.value as Privacy, publish_at: e.target.value === "scheduled" ? meta.publish_at ?? nextSlot() : meta.publish_at })}>
                  <option value="scheduled">Zaplanowany</option>
                  <option value="public">Publiczny od razu</option>
                  <option value="private">Prywatny (tylko wyślij)</option>
                </select>
              </label>
              {meta.privacy !== "private" && meta.privacy !== "public" && (
                <label className="field">Kiedy<input type="datetime-local" value={localInput(meta.publish_at ?? nextSlot())} onChange={(e) => setM({ publish_at: e.target.value ? new Date(e.target.value).toISOString() : undefined })} /></label>
              )}
            </div>
            {cmv && <label className="field check"><input type="checkbox" checked={meta.cleanup !== false} onChange={(e) => setM({ cleanup: e.target.checked })} />Po wysłaniu usuń pliki z chmury (R2)</label>}
            {!cmv && job.kind === "sf_long" && <p className="sub">Shorty idą w kolejne dni po filmie.</p>}
            <div className={s.row}>
              <button className="btn primary" disabled={!!busy || !canPublish} onClick={() => act("Publikacja", "publish", { meta })}>
                {onYt.length ? "Zastosuj na YouTube" : "Wyślij na YouTube"}
              </button>
              <button className="btn" disabled={!!busy || !dirty} onClick={() => run("Zapis", save)}>Zapisz</button>
            </div>
          </section>
        )}

        <div className="actions">
          <button className={`btn danger ${armed ? "armed" : ""}`} disabled={!!busy} onClick={async () => {
            if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return; }
            const r = await run("Usuwanie", () => action(job.id, "archive"));
            if (r) { flash(cmv ? "Usunięto zadanie i jego pliki z chmury" : "Ukryto zadanie"); onRemoved(job.id); }
          }}>{armed ? "Na pewno?" : cmv ? "Usuń zadanie" : "Ukryj"}</button>
          <div>
            {dirty && <button className="btn" disabled={!!busy} onClick={() => run("Zapis", save)}>Zapisz</button>}
            <button className="btn" onClick={() => { save().catch(() => {}); onClose(); }}>Zamknij</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FileRow({ label, accept, role, multiple, job, onFile, onRemove, busy }: {
  label: string; accept: string; role: Asset["role"]; multiple?: boolean; job: VideoJob;
  onFile: (role: Asset["role"], f: FileList | null) => void; onRemove: (a: Asset) => void; busy: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const mine = job.assets.filter((a) => a.role === role);
  return (
    <div className={s.file}>
      <div className={s.row}>
        <span className="label">{label}</span>
        <button className="btn" disabled={busy} onClick={() => ref.current?.click()}>{mine.length && !multiple ? "Zmień" : "Dodaj"}</button>
        <input ref={ref} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => { onFile(role, e.target.files); e.target.value = ""; }} />
      </div>
      {mine.map((a) => (
        <div key={a.key} className={s.asset}>
          <span>{a.name} · {gb(a.size)}</span>
          <button className="btn" disabled={busy} onClick={() => onRemove(a)} aria-label={`Usuń ${a.name}`}>✕</button>
        </div>
      ))}
    </div>
  );
}

function Segment({ params, setP }: { params: Params; setP: (p: Partial<Params>) => void }) {
  const seg = params.segment;
  const [a, setA] = useState(seg ? mmss(seg.start) : "");
  const [b, setB] = useState(seg ? mmss(seg.end) : "");
  const commit = (x: string, y: string) => {
    const s1 = parseMmss(x), s2 = parseMmss(y);
    setP({ segment: s1 != null && s2 != null && s2 > s1 + 3 ? { start: s1, end: Math.min(s2, s1 + 180) } : null });
  };
  return (
    <div className={s.two}>
      <label className="field">Od (m:ss)<input inputMode="decimal" placeholder="auto" value={a} onChange={(e) => setA(e.target.value)} onBlur={() => commit(a, b)} /></label>
      <label className="field">Do (m:ss)<input inputMode="decimal" placeholder="auto" value={b} onChange={(e) => setB(e.target.value)} onBlur={() => commit(a, b)} /></label>
      <p className="sub" style={{ gridColumn: "1/-1", margin: 0 }}>Puste = pierwszy refren (do 45 s).</p>
    </div>
  );
}

function StyleFields({ style, set }: { style: Style; set: (p: Partial<Style>) => void }) {
  const slider = (k: "grain" | "glow" | "shake" | "glitch" | "dim", l: string) => (
    <label className="field" key={k}>{l} · {Math.round(style[k] * 100)} %<input type="range" min={0} max={1} step={0.05} value={style[k]} onChange={(e) => set({ [k]: Number(e.target.value) })} /></label>
  );
  const color = (k: "textColor" | "accent" | "bg1" | "bg2", l: string) => (
    <label className="field" key={k}>{l}<input type="color" value={style[k]} onChange={(e) => set({ [k]: e.target.value })} /></label>
  );
  return (
    <div className={s.two}>
      <label className="field">Układ<select value={style.layout} onChange={(e) => set({ layout: e.target.value as Style["layout"] })}>{Object.entries(LAYOUTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field">Font<select value={style.font} onChange={(e) => set({ font: e.target.value as Style["font"] })}>{Object.entries(FONTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field">Litery<select value={style.textCase} onChange={(e) => set({ textCase: e.target.value as Style["textCase"] })}><option value="normal">Jak w tekście</option><option value="upper">WIELKIE</option><option value="lower">małe</option></select></label>
      <label className="field">Wielkość · {Math.round(style.fontScale * 100)} %<input type="range" min={0.6} max={1.6} step={0.05} value={style.fontScale} onChange={(e) => set({ fontScale: Number(e.target.value) })} /></label>
      {color("textColor", "Tekst")}{color("accent", "Akcent")}{color("bg1", "Tło 1")}{color("bg2", "Tło 2")}
      {slider("dim", "Przyciemnienie tła")}
      <label className="field">Rozmycie tła · {style.blur}px<input type="range" min={0} max={30} step={1} value={style.blur} onChange={(e) => set({ blur: Number(e.target.value) })} /></label>
      {slider("grain", "Ziarno")}{slider("glow", "Poświata")}{slider("shake", "Trzęsienie w refrenie")}{slider("glitch", "Glitch w refrenie")}
      <label className="field">Napis u góry<input maxLength={40} value={style.badge} onChange={(e) => set({ badge: e.target.value })} placeholder="pusty = brak" /></label>
      <label className="field check"><input type="checkbox" checked={style.intro} onChange={(e) => set({ intro: e.target.checked })} />Plansza tytułowa</label>
      <label className="field check"><input type="checkbox" checked={style.footer} onChange={(e) => set({ footer: e.target.checked })} />Stopka z paskiem</label>
      <label className="field check"><input type="checkbox" checked={style.kenBurns} onChange={(e) => set({ kenBurns: e.target.checked })} />Powolny zoom tła</label>
      <button className="btn" style={{ alignSelf: "end" }} onClick={() => set(cleanStyle({}, presetStyle("night", "lyric")))}>Reset</button>
    </div>
  );
}
