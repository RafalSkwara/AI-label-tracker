import { ownerDb, signLink } from "@/lib/server/auth";
import { cancelRun, dispatch } from "@/lib/server/github";
import { generateBackground } from "@/lib/server/background";
import { media, removePrefix } from "@/lib/server/media";
import { ACTIVE, blocked, type Meta, type Output, type VideoJob } from "@/lib/video";

type Body = { action?: string; meta?: Meta; key?: string; keys?: string[]; prompt?: string };
const err = (error: string, status = 400) => Response.json({ error }, { status });

function cleanMeta(m: Meta | undefined, current: Meta): Meta {
  if (!m) return current;
  const tags = Array.isArray(m.tags) ? m.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 40) : current.tags;
  const at = m.publish_at && !isNaN(Date.parse(m.publish_at)) ? new Date(m.publish_at).toISOString() : undefined;
  return {
    title: typeof m.title === "string" ? m.title.trim().slice(0, 100) : current.title,
    description: typeof m.description === "string" ? m.description.slice(0, 4900) : current.description,
    tags,
    privacy: m.privacy && ["private", "scheduled", "public"].includes(m.privacy) ? m.privacy : current.privacy ?? "scheduled",
    publish_at: at,
    cleanup: typeof m.cleanup === "boolean" ? m.cleanup : current.cleanup,
  };
}

/** POST { action: render | publish | cancel | archive | clean | link | remove-asset, ... } on the caller's own job */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await ownerDb(req);
  if (!c) return err("unauthorized", 401);
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Body;
  const { data: job } = await c.db.from("video_jobs").select("*").eq("id", id).is("archived_at", null).maybeSingle<VideoJob>();
  if (!job) return err("not found", 404);
  const update = async (patch: Record<string, unknown>) => {
    const { data, error } = await c.db.from("video_jobs").update(patch).eq("id", id).select("*").single<VideoJob>();
    if (error) throw new Error(error.message);
    return data;
  };
  const fresh = async () => (await c.db.from("video_jobs").select("*").eq("id", id).single<VideoJob>()).data;
  const active = ACTIVE.includes(job.status);

  try {
    switch (body.action) {
      case "render": {
        if (active) return err("już trwa");
        const missing = blocked(job);
        if (missing.length) return err(`brakuje: ${missing.map((m) => m.label).join(", ")}`);
        // optional background prompt: make the image now if none was uploaded or generated yet
        const bgPrompt = job.params.bg_prompt?.trim();
        if (job.brand === "cmv" && job.kind !== "music_video" && bgPrompt && !job.assets.some((a) => a.role === "background")) {
          try { await generateBackground(c.db, job, bgPrompt); } catch (e) { return err(`tło: ${(e as Error).message}`, 502); }
        }
        const prev = { status: job.status, stage: job.stage };
        await update({ status: "queued", stage: "Czeka na maszynę GitHub", progress: 0, error: null, run_id: null, run_url: null });
        try {
          await dispatch("job.yml", { job_id: id, action: "render", brand: job.brand });
        } catch (e) {
          await update(prev);
          return err(`nie udało się uruchomić: ${(e as Error).message}`, 502);
        }
        return Response.json(await fresh());
      }
      case "publish": {
        if (active) return err("już trwa");
        const meta = cleanMeta(body.meta, job.meta);
        if (meta.privacy === "scheduled" && meta.publish_at && Date.parse(meta.publish_at) < Date.now() + 15 * 60e3) return err("termin publikacji musi być co najmniej 15 min w przyszłości");
        const hasFiles = job.outputs.some((o) => (o.key && !o.removed_at) || (o.video_id && o.yt_status !== "removed"));
        if (!hasFiles) return err("najpierw wyrenderuj wideo");
        const prev = { status: job.status, stage: job.stage };
        await update({ meta, status: "queued", stage: "Czeka na maszynę GitHub", progress: 0, error: null, run_id: null, run_url: null });
        try {
          await dispatch("job.yml", { job_id: id, action: "publish", brand: job.brand });
        } catch (e) {
          await update(prev);
          return err(`nie udało się uruchomić: ${(e as Error).message}`, 502);
        }
        return Response.json(await fresh());
      }
      case "background": {
        const prompt = (body.prompt ?? job.params.bg_prompt ?? "").trim();
        if (job.brand !== "cmv" || !prompt) return err("brak promptu tła");
        if (active) return err("już trwa");
        await update({ params: { ...job.params, bg_prompt: prompt } });
        return Response.json(await generateBackground(c.db, { ...job, params: { ...job.params, bg_prompt: prompt } }, prompt));
      }
      case "save-meta":
        return Response.json(await update({ meta: cleanMeta(body.meta, job.meta) }));
      case "cancel": {
        if (job.run_id) await cancelRun(job.run_id);
        return Response.json(await update({ status: "cancelled", stage: null, finished_at: new Date().toISOString() }));
      }
      case "clean": {
        const b = media();
        if (!b) return err("R2 unavailable", 503);
        const keys = new Set(body.keys?.length ? body.keys : job.outputs.filter((o) => o.key && !o.removed_at).map((o) => o.key!));
        const outputs: Output[] = job.outputs.map((o) => (o.key && keys.has(o.key) && !o.removed_at ? { ...o, removed_at: new Date().toISOString() } : o));
        const gone = job.outputs.filter((o) => o.key && keys.has(o.key) && !o.removed_at).map((o) => o.key!);
        if (gone.length) await b.delete(gone);
        return Response.json(await update({ outputs }));
      }
      case "remove-asset": {
        const b = media();
        const a = job.assets.find((x) => x.key === body.key);
        if (!b || !a) return err("not found", 404);
        await b.delete(a.key);
        return Response.json(await update({ assets: job.assets.filter((x) => x.key !== a.key) }));
      }
      case "archive": {
        if (active && job.run_id) await cancelRun(job.run_id).catch(() => {});
        const b = media();
        // CMV files are this job's alone; Slowfall scene assets stay (the scene folder belongs to the pipeline)
        if (b && job.brand === "cmv") await removePrefix(b, `jobs/${id}/`);
        await update({ archived_at: new Date().toISOString(), status: active ? "cancelled" : job.status });
        return Response.json({ ok: true });
      }
      case "link": {
        const own = [...job.outputs.map((o) => o.key), ...job.assets.map((a) => a.key)].filter(Boolean);
        if (!body.key || !own.includes(body.key)) return err("not found", 404);
        return Response.json({ url: `/api/video/file?t=${await signLink(body.key, 30 * 60e3)}` });
      }
      default:
        return err("unknown action");
    }
  } catch (e) {
    return err((e as Error).message, 500);
  }
}
