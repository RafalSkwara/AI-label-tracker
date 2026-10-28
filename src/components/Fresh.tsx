"use client";

import { useState } from "react";
import { localDateTime, nf } from "@/lib/format";
import type { Data, Project, Views24 } from "@/lib/types";
import { groupTraffic } from "@/lib/ytMap";

const HOUR = 36e5;
/** The hourly run is late (or stopped) when the newest snapshot is older than this */
const STALE_MS = 3 * HOUR;

/** Views since the comparison snapshot, and how many hours that snapshot is back (24 once a day of history exists) */
function gained(v: Views24): { views: number; hours: number } | null {
  if (v.base_taken_at == null || v.base_view_count == null) return null;
  return { views: Math.max(0, v.view_count - v.base_view_count), hours: Math.round((Date.parse(v.taken_at) - Date.parse(v.base_taken_at)) / HOUR) };
}

/** "Ostatnie 24 h" per YouTube project from the hourly public counter, plus the traffic breakdown per video */
export default function Fresh({ data, today }: { data: Data; today: string }) {
  const [now] = useState(() => Date.now());
  const projects = data.projects.filter((p: Project) => (p.kind === "yt_channel" || p.kind === "both") && p.status !== "zamknięty");
  const title = (id: string) => data.items.find((i) => i.yt_video_id === id)?.title ?? id;
  const weekAgo = new Date(Date.parse(today) - 7 * 864e5).toISOString().slice(0, 10);
  const blocks = projects.map((p) => {
    const all = data.views24.filter((v) => v.project_id === p.id);
    // Videos that left the 90-day window stop getting snapshots; only the newest snapshot time counts
    const newest = all.reduce((m, v) => (v.taken_at > m ? v.taken_at : m), "");
    const vids = all.filter((v) => v.taken_at === newest);
    const total = vids.map(gained).filter((g) => g != null);
    const hours = total.length ? Math.max(...total.map((g) => g.hours)) : 0;
    const stale = newest !== "" && now - Date.parse(newest) > STALE_MS;
    const fresh = data.items.filter((i) => i.project_id === p.id && i.yt_video_id && i.publish_date && i.publish_date >= weekAgo)
      .map((i) => { const v = vids.find((x) => x.yt_video_id === i.yt_video_id); return { item: i, g: v ? gained(v) : null }; })
      .filter((x) => x.g);
    // Dziś lists the breakdown only for films from the last 7 days, like the 24 h list
    const recentIds = new Set(data.items.filter((i) => i.project_id === p.id && i.yt_video_id && i.publish_date && i.publish_date >= weekAgo).map((i) => i.yt_video_id));
    const withTraffic = [...new Set(data.traffic.filter((t) => t.project_id === p.id && recentIds.has(t.yt_video_id)).map((t) => t.yt_video_id))];
    return { p, sum: total.reduce((a, g) => a + g.views, 0), has: total.length > 0, hours, stale, newest, fresh, withTraffic };
  }).filter((b) => b.has || b.withTraffic.length);
  if (!blocks.length) return null;

  return (
    <section className="fresh" aria-label="Ostatnie 24 h">
      <span className="label">Ostatnie 24 h</span>
      {blocks.map(({ p, sum, has, hours, stale, newest, fresh, withTraffic }) => (
        <article key={p.id} className="gate">
          <div className="head">
            <div style={{ minWidth: 0 }}>
              <h3>{p.name}</h3>
              <p className="sub">licznik publiczny, ~1 h{has && hours !== 24 ? ` · dane z ostatnich ${hours} h` : ""}{stale ? ` · stan z ${localDateTime(newest)}` : ""}</p>
            </div>
            {has && <span className="big">+{nf().format(sum)}</span>}
          </div>
          {!has && <p className="sub">Czekam na pierwsze dwie godzinne migawki.</p>}
          {fresh.length > 0 && (
            <ul className="rules">
              {fresh.map(({ item, g }) => <li key={item.id}><span className="ok" aria-hidden="true">+{nf().format(g!.views)}</span><span>{item.title}</span></li>)}
            </ul>
          )}
          {withTraffic.map((id) => <VideoWhy key={id} data={data} id={id} name={title(id)} />)}
        </article>
      ))}
    </section>
  );
}

/** Traffic-source shares (last 28 days) and the top 10 search terms of one video */
function VideoWhy({ data, id, name }: { data: Data; id: string; name: string }) {
  const rows = data.traffic.filter((t) => t.yt_video_id === id);
  const terms = data.terms.filter((t) => t.yt_video_id === id).slice(0, 10);
  const groups = groupTraffic(rows).filter((g) => g.views > 0);
  return (
    <details className="why">
      <summary>{name}</summary>
      <p className="sub">Źródła ruchu, 28 dni do {rows[0]?.period_end.split("-").reverse().join(".")}</p>
      {groups.map((g) => (
        <div key={g.group} className="share"><span>{g.group}</span><span className="bar" aria-hidden="true"><i style={{ width: Math.round(g.share * 100) + "%" }} /></span><span>{Math.round(g.share * 100)}%</span></div>
      ))}
      {!groups.length && <p className="sub">Brak danych o źródłach.</p>}
      {terms.length > 0 && (
        <>
          <p className="sub">Frazy z wyszukiwarki YouTube</p>
          <ul className="rules">{terms.map((t) => <li key={t.term}><span className="nd">{nf().format(t.views)}</span><span>{t.term}</span></li>)}</ul>
        </>
      )}
    </details>
  );
}
