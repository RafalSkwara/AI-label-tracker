// Worker entry: OpenNext handles requests; the daily cron calls /api/cron through the same handler (no request context otherwise).
// Build output, exists only after `opennextjs-cloudflare build` (worker.ts is excluded from tsc)
import openNext from "./.open-next/worker.js";

type Env = { CRON_SECRET: string } & Record<string, unknown>;

const handler = {
  fetch: (request: Request, env: Env, ctx: unknown) => openNext.fetch(request, env, ctx),
  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const req = new Request("https://cron.internal/api/cron", { method: "POST", headers: { "x-cron-secret": env.CRON_SECRET } });
    ctx.waitUntil(
      Promise.resolve(openNext.fetch(req, env, ctx)).then(
        (res: Response) => { if (!res.ok) console.error("cron failed with status", res.status); },
        (e: Error) => console.error("cron request failed:", e.message),
      ),
    );
  },
};

export default handler;
