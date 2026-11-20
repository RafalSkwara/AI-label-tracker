import { ownerDb } from "@/lib/server/auth";
import { media } from "@/lib/server/media";
import type { Asset, VideoJob } from "@/lib/video";

const MAX = 95 * 1024 * 1024; // Workers request body limit is 100 MB
const ROLES: Asset["role"][] = ["audio", "background", "clip", "timing"];
const TYPES: Record<Asset["role"], RegExp> = {
  audio: /\.(mp3|wav|m4a|flac|ogg)$/i,
  background: /\.(png|jpe?g|webp|mp4|mov|webm)$/i,
  clip: /\.(mp4|mov|webm)$/i,
  timing: /\.json$/i,
};

/** POST raw file body ?job=<id>&role=<role>&name=<file name> → stored in R2 jobs/<id>/in/, listed in the job's assets */
export async function POST(req: Request) {
  const c = await ownerDb(req);
  if (!c) return Response.json({ error: "unauthorized" }, { status: 401 });
  const u = new URL(req.url);
  const id = u.searchParams.get("job") ?? "";
  const role = u.searchParams.get("role") as Asset["role"];
  const name = (u.searchParams.get("name") ?? "").replace(/[^\w.\- ]+/g, "").trim().slice(0, 80);
  const size = Number(req.headers.get("content-length") ?? 0);
  if (!ROLES.includes(role) || !name || !TYPES[role].test(name)) return Response.json({ error: "zły typ pliku" }, { status: 400 });
  if (!size || size > MAX) return Response.json({ error: "plik większy niż 95 MB" }, { status: 413 });
  const { data: job } = await c.db.from("video_jobs").select("id,brand,assets").eq("id", id).is("archived_at", null).maybeSingle<Pick<VideoJob, "id" | "brand" | "assets">>();
  if (!job || job.brand !== "cmv" || !req.body) return Response.json({ error: "not found" }, { status: 404 });
  const b = media();
  if (!b) return Response.json({ error: "R2 unavailable" }, { status: 503 });

  const key = `jobs/${id}/in/${crypto.randomUUID().slice(0, 8)}-${name.replace(/\s+/g, "-")}`;
  await b.put(key, req.body, { httpMetadata: { contentType: req.headers.get("content-type") ?? "application/octet-stream" } });
  // one song / background / timing per job: a new upload replaces the old one
  const single = role !== "clip";
  const replaced = single ? job.assets.filter((a) => a.role === role) : [];
  if (replaced.length) await b.delete(replaced.map((a) => a.key));
  const assets = [...job.assets.filter((a) => !replaced.includes(a)), { key, name, size, role }];
  const { data, error } = await c.db.from("video_jobs").update({ assets }).eq("id", id).select("*").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json(data);
}
