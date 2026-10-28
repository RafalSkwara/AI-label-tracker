// Worker entry: OpenNext handles requests; cron triggers call /api/cron through the same handler (no request context otherwise).
// Build output, exists only after `opennextjs-cloudflare build` (worker.ts is excluded from tsc)
import openNext from "./.open-next/worker.js";

type Env = { CRON_SECRET: string } & Record<string, unknown>;

/** Must match `triggers.crons` in wrangler.jsonc; an expression not listed here runs nothing */
const KINDS: Record<string, "daily" | "hourly"> = { "0 5 * * *": "daily", "30 * * * *": "hourly" };

const handler = {
  fetch: (request: Request, env: Env, ctx: unknown) => openNext.fetch(request, env, ctx),
  async scheduled(controller: { cron: string }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const kind = KINDS[controller.cron];
    if (!kind) { console.error("unknown cron expression, nothing run:", controller.cron); return; }
    const req = new Request("https://cron.internal/api/cron", { method: "POST", headers: { "x-cron-secret": env.CRON_SECRET, "x-cron-kind": kind } });
    ctx.waitUntil(
      Promise.resolve(openNext.fetch(req, env, ctx)).then(
        (res: Response) => { if (!res.ok) console.error(kind, "cron failed with status", res.status); },
        (e: Error) => console.error(kind, "cron request failed:", e.message),
      ),
    );
  },
};

export default handler;
