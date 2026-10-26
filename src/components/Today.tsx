"use client";

import { dmy } from "@/lib/format";
import { type Alert, alerts, gateRules, gateStatus } from "@/lib/rules";
import type { Data } from "@/lib/types";

const SEV = { high: "Pilne", med: "Wkrótce", low: "Info" } as const;
const days = (n: number) => (n === 0 ? "dziś" : n < 0 ? `${-n} ${n === -1 ? "dzień" : "dni"} po terminie` : `za ${n} ${n === 1 ? "dzień" : "dni"}`);

/** Alerts that open a record are tappable; the rest are informational */
export const opensRecord = (a: Alert) => a.kind !== "gate" && a.kind !== "sync_failed";

export default function Today({ data, today, onOpen }: { data: Data; today: string; onOpen: (a: Alert) => void }) {
  const list = alerts(data, today);
  const pname = (id?: string) => data.projects.find((p) => p.id === id)?.name;
  return (
    <div className="today">
      <div className="panelhead">
        <div><h2>Dziś</h2><p className="sub">{dmy(today)} · alerty i bramki decyzyjne</p></div>
      </div>

      <section className="alerts" aria-label="Alerty">
        <span className="label">Alerty · {list.length}</span>
        {!list.length && <div className="empty"><strong>Nic pilnego</strong><span>Brak zaległych zadań, odnowień i spadków.</span></div>}
        {list.map((a) => {
          const body = (
            <>
              <span className="sev">{SEV[a.severity]}</span>
              <span style={{ minWidth: 0 }}>
                <div className="t">{a.title}</div>
                <div className="d">{a.detail}{pname(a.projectId) ? " · " + pname(a.projectId) : ""}</div>
              </span>
            </>
          );
          return opensRecord(a)
            ? <button key={a.kind + a.ref} className={"alert " + a.severity} onClick={() => onOpen(a)}>{body}</button>
            : <div key={a.kind + a.ref} className={"alert " + a.severity}>{body}</div>;
        })}
      </section>

      <section className="gates" aria-label="Bramki">
        <span className="label">Bramki</span>
        {!data.gates.length && <div className="empty"><strong>Brak bramek</strong><span>Bramki decyzyjne pojawią się tutaj.</span></div>}
        {data.gates.map((g) => {
          const s = gateStatus(g, data, today), rules = gateRules(g, data, today);
          const state = s.ok === true ? "ok" : s.ok === false ? "no" : "nd";
          return (
            <article key={g.id} className="gate">
              <div className="head">
                <div style={{ minWidth: 0 }}>
                  <h3>{g.title}</h3>
                  <p className="sub">{pname(g.project_id)} · do {dmy(g.due)} ({days(s.daysLeft)})</p>
                </div>
                <span className={"pill " + state}>{s.ok === true ? "spełniona" : s.ok === false ? "niespełniona" : "brak danych"}</span>
              </div>
              <ul className="rules">
                {rules.map((r, i) => (
                  <li key={i}><span className={r.ok === true ? "ok" : r.ok === false ? "no" : "nd"} aria-hidden="true">{r.ok === true ? "✓" : r.ok === false ? "✗" : "–"}</span><span>{r.label}</span></li>
                ))}
              </ul>
              {g.note && <p className="sub">{g.note}</p>}
            </article>
          );
        })}
      </section>
    </div>
  );
}
