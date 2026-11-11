"use client";

import { useEffect, useState } from "react";
import { disablePush, enablePush, type PushState, pushState, testPush } from "./client";

const NOTE: Record<Exclude<PushState, "on" | "off">, string> = {
  unsupported: "Ta przeglądarka nie obsługuje powiadomień.",
  "ios-install": "Na iPhonie: Udostępnij → Do ekranu początkowego, potem otwórz apkę z ikony i włącz powiadomienia.",
  denied: "Powiadomienia są zablokowane w ustawieniach przeglądarki dla tej strony.",
};

/** Per-device push switch (one subscription per device serves every kind of reminder); title/desc describe what the page reminds about */
export default function PushToggle({ flash, title = "Przypomnienia o płatnościach", on = "Włączone na tym urządzeniu: 3 dni przed, dzień przed i w dniu płatności, ok. 8:00.", off = "Powiadomienie push przed odnowieniem aktywnej subskrypcji." }: { flash: (msg: string) => void; title?: string; on?: string; off?: string }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { pushState().then(setState, () => setState("unsupported")); }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e) { flash(`Powiadomienia: ${(e as Error).message}`); }
    setState(await pushState().catch(() => "unsupported" as const));
    setBusy(false);
  }

  if (!state) return null;
  return (
    <div className="panel pushbox">
      <div>
        <strong>{title}</strong>
        <p className="sub">{state === "on" ? on : state === "off" ? off : NOTE[state]}</p>
      </div>
      {(state === "on" || state === "off") && (
        <div className="row">
          {state === "on" && <button className="btn" disabled={busy} onClick={() => run(async () => { const r = await testPush(); flash(r.sent ? "Wysłano testowe powiadomienie" : "Nie udało się wysłać testu"); })}>Wyślij test</button>}
          <button className={`btn ${state === "off" ? "primary" : ""}`} disabled={busy} onClick={() => run(state === "on" ? disablePush : enablePush)}>
            {busy ? "…" : state === "on" ? "Wyłącz" : "Włącz"}
          </button>
        </div>
      )}
    </div>
  );
}
