import { supabase } from "@/lib/supabase";
import { type Kind, type Meta, presetStyle, type Style, type VideoJob } from "@/lib/video";

const CMV_PROJECT = "7cc9f08a-2cd8-4b77-b3ce-4dd47f7ce84d";

async function token() {
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? "";
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { authorization: `Bearer ${await token()}`, ...(init.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...init.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `błąd ${res.status}`);
  return data as T;
}

export async function loadJobs(): Promise<VideoJob[]> {
  const { data, error } = await supabase().from("video_jobs").select("*").is("archived_at", null).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data as VideoJob[];
}

export async function createCmv(kind: Kind, song: string): Promise<VideoJob> {
  const suffix = kind === "lyric" ? " (Lyric Video)" : kind === "music_video" ? " (Official Video)" : "";
  const row = {
    brand: "cmv", kind, project_id: CMV_PROJECT, title: song + (kind === "short" ? " · short" : ""),
    params: { song, artist: "Contents May Vary", preset: kind === "short" ? "punk" : "night", style: presetStyle(kind === "short" ? "punk" : "night", kind), formats: kind === "lyric" ? ["16:9"] : undefined, show_lyrics: kind === "music_video" ? true : undefined, segment: null },
    meta: { title: `Contents May Vary - ${song}${suffix}`, description: "", tags: ["contents may vary", "pop punk", song.toLowerCase()], privacy: "scheduled", cleanup: true },
  };
  const { data, error } = await supabase().from("video_jobs").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  return data as VideoJob;
}

/** Shorts-only job for a Slowfall scene (one per scene; reused when it exists) */
export async function shortsFor(scene: VideoJob): Promise<VideoJob> {
  const db = supabase();
  const { data: found } = await db.from("video_jobs").select("*").eq("brand", "slowfall").eq("kind", "sf_shorts").eq("slug", scene.slug!).maybeSingle();
  if (found) {
    const { data } = await db.from("video_jobs").update({ archived_at: null }).eq("id", found.id).select("*").single();
    return data as VideoJob;
  }
  const { data, error } = await db.from("video_jobs").insert({
    brand: "slowfall", kind: "sf_shorts", slug: scene.slug, project_id: "b765d5bc-a2bc-4576-b04d-57d0619ea3ee",
    title: `${scene.title} · Shorty`, checks: scene.checks, meta: { privacy: "scheduled" },
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data as VideoJob;
}

export async function saveJob(id: string, patch: Partial<Pick<VideoJob, "title" | "params" | "meta">>): Promise<VideoJob> {
  const { data, error } = await supabase().from("video_jobs").update(patch).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data as VideoJob;
}

export const action = (id: string, act: string, extra: Record<string, unknown> = {}) =>
  api<VideoJob & { url?: string; ok?: boolean }>(`/api/video/${id}`, { method: "POST", body: JSON.stringify({ action: act, ...extra }) });

export const syncNow = () => api<{ ok: boolean }>("/api/video/sync", { method: "POST" });

export const applyInstructions = (instructions: string, style: Style, kind: Kind) =>
  api<{ style: Style; note: string }>("/api/video/style", { method: "POST", body: JSON.stringify({ instructions, style, kind }) });

export async function upload(id: string, role: string, file: File): Promise<VideoJob> {
  if (file.size > 95 * 1024 * 1024) throw new Error("plik większy niż 95 MB");
  const q = new URLSearchParams({ job: id, role, name: file.name });
  return api<VideoJob>(`/api/video/upload?${q}`, { method: "POST", body: file, headers: { "content-type": file.type || "application/octet-stream" } });
}

export async function download(id: string, key: string) {
  const { url } = await action(id, "link", { key });
  if (url) window.location.href = url;
}

export type { Meta };
