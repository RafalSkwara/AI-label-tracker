"use client";

import { useEffect, useState } from "react";
import { disablePush, enablePush, type PushState, pushState, testPush } from "./client";

const NOTE: Record<Exclude<PushState, "on" | "off">, string> = {
  unsupported: "Ta przeglądarka nie obsługuje powiadomień.",
  "ios-install": "Na iPhonie: Udostępnij → Do ekranu początkowego, potem otwórz apkę z ikony i włącz powiadomienia.",
  denied: "Powiadomienia są zablokowane w ustawieniach przeglądarki dla tej strony.",
};

/** Per-device switch for subscription renewal reminders (3 days before, the day before, on the day; ~8:00) */
export default function PushToggle({ flash }: { flash: (msg: string) => void }) {
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
        <strong>Przypomnienia o płatnościach</strong>
        <p className="sub">{state === "on" ? "Włączone na tym urządzeniu: 3 dni przed, dzień przed i w dniu płatności, ok. 8:00." : state === "off" ? "Powiadomienie push przed odnowieniem aktywnej subskrypcji." : NOTE[state]}</p>
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
