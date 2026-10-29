// Old host -> new host. Separate worker (name `ai-label-tracker`), deployed by hand:
//   npx wrangler deploy -c redirect-worker/wrangler.jsonc
// Keeps path and query. The main worker has no redirect logic (its cron calls itself on `cron.internal`).
const NEW_ORIGIN = "https://side-hustle-assistant.sidereus.workers.dev";

const handler = {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    return Response.redirect(NEW_ORIGIN + url.pathname + url.search, 301);
  },
};

export default handler;
