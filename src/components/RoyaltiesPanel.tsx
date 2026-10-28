"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DistroKidFormatError, type ImportPlan, type MonthLine, monthTotals, parseDistroKid, planImport } from "@/lib/distrokid";
import { monthLabel, nf, pln2, usd2 } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import type { Data } from "@/lib/types";

const PAGE = 1000; // PostgREST returns at most 1000 rows per request
const BATCH = 500;
const TOP_TRACKS = 5;

async function loadLines(): Promise<MonthLine[]> {
  const out: MonthLine[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase().from("v_royalties_month").select("project_id,sale_month,title,quantity,earnings_usd")
      .order("sale_month", { ascending: false }).order("project_id").order("title").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data as MonthLine[]));
    if (data.length < PAGE) return out;
  }
}

/** Inserts the planned rows, skipping hashes already stored; returns how many were really new */
async function store(plan: ImportPlan): Promise<number> {
  let added = 0;
  for (let i = 0; i < plan.rows.length; i += BATCH) {
    const { data, error } = await supabase().from("royalties")
      .upsert(plan.rows.slice(i, i + BATCH), { onConflict: "import_hash", ignoreDuplicates: true }).select("id");
    if (error) throw new Error(error.message);
    added += data.length;
  }
  return added;
}

type Summary = { added: number; duplicates: number; skipped: number; skippedArtists: ImportPlan["skipped"]; invalid: number };

export default function RoyaltiesPanel({ data, flash }: { data: Data; flash: (m: string) => void }) {
  const [lines, setLines] = useState<MonthLine[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [formatError, setFormatError] = useState("");

  const refresh = useCallback(() => loadLines().then((l) => { setLines(l); setError(""); }, (e: Error) => setError(e.message)), []);
  useEffect(() => { refresh(); }, [refresh]);

  const rate = Number(data.settings.usd_pln) || 0;
  const totals = useMemo(() => monthTotals(lines ?? []), [lines]);
  const artistProjects = data.projects.filter((p) => p.kind === "artist" || p.kind === "both");
  const unmapped = artistProjects.filter((p) => !p.distrokid_artist && p.status !== "zamknięty");
  const blocks = data.projects.map((p) => ({ p, months: totals.filter((t) => t.project_id === p.id) })).filter((b) => b.months.length);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setSummary(null);
    setFormatError("");
    try {
      const plan = await planImport(parseDistroKid(await file.text()), data.projects);
      const added = await store(plan);
      const skipped = plan.skipped.reduce((a, s) => a + s.count, 0) + plan.invalid;
      setSummary({ added, duplicates: plan.rows.length - added, skipped, skippedArtists: plan.skipped, invalid: plan.invalid });
      flash(`Zaimportowano ${added}, pominięto ${skipped}`);
      await refresh();
    } catch (e) {
      if (e instanceof DistroKidFormatError) setFormatError("To nie wygląda na plik z DistroKid. Brakuje kolumn: " + e.missing.join(", ") + ".");
      else flash("Nie zaimportowano: " + (e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div className="royalties">
      <div className="panelhead">
        <div><h2>Muzyka</h2><p className="sub">Import miesięcznego eksportu z DistroKid Bank · kurs {nf(2).format(rate)} zł/USD</p></div>
      </div>

      <section className="gate" aria-label="Import">
        <p className="sub" style={{ margin: 0 }}>Wybierz plik CSV lub TSV wyeksportowany z DistroKid. Ten sam plik można wczytać ponownie, nic się nie zdubluje.</p>
        <label className="btn primary filebtn" aria-disabled={busy}>
          {busy ? "Importuję…" : "Wybierz plik z DistroKid"}
          <input type="file" accept=".csv,.tsv,text/csv" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; onFile(f); }} />
        </label>
        {formatError && <p className="sub ytstate no" role="alert" style={{ margin: 0 }}>{formatError}</p>}
        {summary && (
          <div className="summary" role="status">
            <strong>Zaimportowano {summary.added}, pominięto {summary.skipped}</strong>
            {summary.duplicates > 0 && <span className="sub">Już w bazie: {summary.duplicates}</span>}
            {summary.skippedArtists.length > 0 && (
              <>
                <span className="sub">Nieznani artyści (brak projektu z taką nazwą w DistroKid):</span>
                <ul>{summary.skippedArtists.map((s) => <li key={s.artist}>{s.artist} · {s.count}</li>)}</ul>
              </>
            )}
            {summary.invalid > 0 && <span className="sub">Nieczytelne wiersze: {summary.invalid}</span>}
          </div>
        )}
        {unmapped.length > 0 && <p className="sub" style={{ margin: 0 }}>Bez nazwy artysty DistroKid (ich wiersze zostaną pominięte): {unmapped.map((p) => p.name).join(", ")}.</p>}
      </section>

      {error && <div className="banner"><span>Nie wczytano przychodów: {error}</span><button className="btn" onClick={refresh}>Spróbuj ponownie</button></div>}
      {!error && lines == null && <div className="empty"><strong>Wczytywanie…</strong><span>Dane przychodzą z Supabase.</span></div>}
      {!error && lines != null && !blocks.length && <div className="empty"><strong>Brak przychodów</strong><span>Zaimportuj pierwszy eksport z DistroKid Bank.</span></div>}

      {blocks.map(({ p, months }) => {
        const sumUsd = months.reduce((a, m) => a + m.usd, 0);
        return (
          <article key={p.id} className="gate roy" aria-label={p.name}>
            <div className="head">
              <div style={{ minWidth: 0 }}>
                <h3>{p.name}</h3>
                <p className="sub">razem {usd2(sumUsd)} · {pln2(sumUsd * rate)}</p>
              </div>
            </div>
            {months.map((m) => (
              <details key={m.month} className="why">
                <summary>
                  <span className="mo">{monthLabel(m.month)}</span>
                  <span className="val">{usd2(m.usd)}</span>
                  <span className="sub">{nf().format(m.quantity)} streamów</span>
                  <span className="sub val">{pln2(m.usd * rate)}</span>
                </summary>
                <span className="label">Top utwory</span>
                {m.tracks.slice(0, TOP_TRACKS).map((t) => (
                  <div key={t.title} className="track">
                    <span className="t">{t.title}</span>
                    <span className="val">{usd2(t.usd)}</span>
                    <span className="sub">{nf().format(t.quantity)} streamów</span>
                    <span className="sub val">{pln2(t.usd * rate)}</span>
                  </div>
                ))}
                {m.tracks.length > TOP_TRACKS && <p className="sub" style={{ margin: 0 }}>+ {m.tracks.length - TOP_TRACKS} więcej</p>}
              </details>
            ))}
          </article>
        );
      })}
    </div>
  );
}
