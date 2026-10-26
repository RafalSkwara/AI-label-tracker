import { verifyState } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/db";
import { ensureReachJob, exchangeCode, myChannel } from "@/lib/server/google";
import { syncAll } from "@/lib/server/ytSync";

const back = (origin: string, yt: string) => Response.redirect(`${origin}/?tab=dzis&yt=${yt}`, 302);

/** Google redirects here with ?code&state: store the refresh token, create the Reporting job, send the owner back to Dziś */
export async function GET(req: Request) {
  const url = new URL(req.url), origin = url.origin;
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) return back(origin, "denied");
  const projectId = await verifyState(state);
  if (!projectId) return back(origin, "error");
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
    await syncAll(db, projectId); // first pull right away; failures land in last_error and show on Dziś
    return back(origin, "ok");
  } catch {
    return back(origin, "error");
  }
}
