import { getCloudflareContext } from "@opennextjs/cloudflare";
import { safeEqual, verifyState } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/db";
import { ensureReachJob, exchangeCode, GoogleError, myChannel } from "@/lib/server/google";
import { syncAll } from "@/lib/server/ytSync";

const CLEAR = "yt_nonce=; Path=/api/yt; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
const back = (origin: string, yt: string) => {
  const res = new Response(null, { status: 302, headers: { location: `${origin}/?tab=dzis&yt=${yt}` } });
  res.headers.append("set-cookie", CLEAR);
  return res;
};

/** Google redirects here with ?code&state: store the refresh token, create the Reporting job, send the owner back to Dziś */
export async function GET(req: Request) {
  const url = new URL(req.url), origin = url.origin;
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) return back(origin, "denied");
  const st = await verifyState(state);
  const cookie = /(?:^|; )yt_nonce=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1] ?? "";
  if (!st || !safeEqual(cookie, st.nonce)) return back(origin, "error"); // bad/expired state, or not the browser that started the flow
  const projectId = st.projectId;
  try {
    const db = serviceDb();
    const { data: project } = await db.from("projects").select("id,yt_channel_id").eq("id", projectId).maybeSingle();
    if (!project) return back(origin, "error");
    const { accessToken, refreshToken } = await exchangeCode(origin, code);
    const channel = await myChannel(accessToken);
    if (project.yt_channel_id && project.yt_channel_id !== channel.id) return back(origin, "wrong-channel");
    const jobId = await ensureReachJob(accessToken);
    const { error } = await db.from("integrations").upsert(
      { project_id: projectId, provider: "youtube", yt_channel_id: channel.id, refresh_token: refreshToken, reporting_job_id: jobId, last_error: null },
      { onConflict: "project_id,provider" });
    if (error) throw new Error(error.message);
    if (!project.yt_channel_id) await db.from("projects").update({ yt_channel_id: channel.id }).eq("id", projectId);
    // First pull runs after the redirect; a failure lands in last_error and shows on Dziś
    getCloudflareContext().ctx.waitUntil(syncAll(db, projectId).then(() => undefined, (e) => console.error("yt first sync:", (e as Error).message)));
    return back(origin, "ok");
  } catch (e) {
    console.error("yt callback:", (e as Error).message); // message only, never the code or tokens
    return back(origin, e instanceof GoogleError && e.code ? e.code : "error");
  }
}
