import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Asset, VideoJob } from "@/lib/video";
import { media } from "./media";

// Workers AI text-to-image (Cloudflare account, no external key). 1024×1024 JPEG; the template
// crops it to 16:9 / 9:16 and blurs + darkens it behind the lyrics, so that resolution is enough even in 4K.
const MODEL = "@cf/black-forest-labs/flux-1-schnell";
type Ai = { run(model: string, input: unknown): Promise<unknown> };

const SUFFIX = ", atmospheric background for a music lyric video, cinematic lighting, wide composition with empty space in the middle, no text, no letters, no logos, no watermark";

/** Prompt → image in R2 as the job's background (replaces the previous one); returns the updated job */
export async function generateBackground(db: SupabaseClient, job: VideoJob, prompt: string): Promise<VideoJob> {
  const ai = (getCloudflareContext().env as unknown as { AI?: Ai }).AI;
  const bucket = media();
  if (!ai || !bucket) throw new Error("AI albo R2 niedostępne");
  const out = (await ai.run(MODEL, { prompt: prompt.trim().slice(0, 1500) + SUFFIX, steps: 8 })) as { image?: string };
  if (!out?.image) throw new Error("AI nie zwróciło obrazu");
  const bytes = Uint8Array.from(atob(out.image), (c) => c.charCodeAt(0));
  const key = `jobs/${job.id}/in/${crypto.randomUUID().slice(0, 8)}-ai-background.jpg`;
  await bucket.put(key, bytes.buffer as ArrayBuffer, { httpMetadata: { contentType: "image/jpeg" } });
  const old = job.assets.filter((a) => a.role === "background");
  if (old.length) await bucket.delete(old.map((a) => a.key));
  const asset: Asset = { key, name: "ai-background.jpg", size: bytes.byteLength, role: "background" };
  const { data, error } = await db.from("video_jobs").update({ assets: [...job.assets.filter((a) => a.role !== "background"), asset] }).eq("id", job.id).select("*").single<VideoJob>();
  if (error) throw new Error(error.message);
  return data;
}
