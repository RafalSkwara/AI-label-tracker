/** Video jobs ("Wideo"): shared by the page and the API routes. The pipeline (Slowfall-pipeline, job.yml) does the work. */

export type Brand = "cmv" | "slowfall";
export type Kind = "lyric" | "short" | "music_video" | "sf_long" | "sf_shorts";
export type Status = "draft" | "queued" | "running" | "ready" | "uploading" | "private" | "scheduled" | "published" | "failed" | "cancelled";
export type Check = { key: string; label: string; ok: boolean; hint?: string; required?: boolean };
export type Asset = { key: string; name: string; size: number; role: "audio" | "background" | "clip" | "timing" };
export type Output = {
  key?: string; label: string; format?: "16:9" | "9:16"; size?: number; width?: number; height?: number;
  video_id?: string; yt_status?: "private" | "scheduled" | "public" | "unlisted" | "removed"; publish_at?: string;
  removed_at?: string; main?: boolean; title?: string;
};
export type Privacy = "private" | "scheduled" | "public";
export type Meta = { title?: string; description?: string; tags?: string[]; privacy?: Privacy; publish_at?: string; cleanup?: boolean };

export type Style = {
  layout: "stack" | "karaoke" | "kinetic" | "minimal";
  font: "inter" | "condensed" | "serif" | "mono" | "marker";
  textCase: "normal" | "upper" | "lower";
  fontScale: number;
  textColor: string; accent: string; bg1: string; bg2: string;
  dim: number; blur: number; kenBurns: boolean;
  grain: number; glow: number; shake: number; glitch: number;
  intro: boolean; footer: boolean; badge: string; chorusSections: string[];
};

export type Params = {
  song?: string; artist?: string; lyrics?: string; instructions?: string; preset?: string;
  style?: Style; formats?: ("16:9" | "9:16")[]; segment?: { start: number; end: number } | null;
  show_lyrics?: boolean; matched?: number; realign?: boolean; publish_at?: string | null;
};

export type VideoJob = {
  id: string; brand: Brand; kind: Kind; title: string; slug: string | null; status: Status;
  stage: string | null; progress: number | null; checks: Check[]; params: Params; meta: Meta;
  assets: Asset[]; outputs: Output[]; run_id: number | null; run_url: string | null; error: string | null;
  started_at: string | null; finished_at: string | null; created_at: string; updated_at: string;
};

export const KIND_LABEL: Record<Kind, string> = {
  lyric: "Lyric video", short: "Short / TikTok", music_video: "Teledysk", sf_long: "Film 2 h", sf_shorts: "Shorty",
};

export const STATUS: Record<Status, { label: string; tone: "" | "ok" | "soon" | "late" }> = {
  draft: { label: "szkic", tone: "" },
  queued: { label: "w kolejce", tone: "soon" },
  running: { label: "w trakcie", tone: "soon" },
  ready: { label: "gotowe do publikacji", tone: "ok" },
  uploading: { label: "wysyłanie", tone: "soon" },
  private: { label: "prywatne na YT", tone: "ok" },
  scheduled: { label: "zaplanowane", tone: "ok" },
  published: { label: "opublikowane", tone: "ok" },
  failed: { label: "błąd", tone: "late" },
  cancelled: { label: "zatrzymane", tone: "" },
};

export const ACTIVE: Status[] = ["queued", "running", "uploading"];

/** Starting looks; same values as cmv/lyric/presets.json in the pipeline */
export const PRESETS: Record<string, { label: string; style: Omit<Style, "badge" | "chorusSections"> }> = {
  night: { label: "Nocny", style: { layout: "stack", font: "inter", textCase: "normal", fontScale: 1, textColor: "#f4f5ff", accent: "#a99bff", bg1: "#141a33", bg2: "#03040a", dim: 0.65, blur: 6, kenBurns: true, grain: 0.5, glow: 0.6, shake: 0.5, glitch: 0, intro: true, footer: true } },
  punk: { label: "Punk", style: { layout: "kinetic", font: "marker", textCase: "upper", fontScale: 1, textColor: "#f5f1e8", accent: "#ff3b3b", bg1: "#2a0a0a", bg2: "#050303", dim: 0.7, blur: 2, kenBurns: false, grain: 0.9, glow: 0.3, shake: 1, glitch: 0.6, intro: true, footer: false } },
  karaoke: { label: "Karaoke", style: { layout: "karaoke", font: "inter", textCase: "normal", fontScale: 1, textColor: "#ffffff", accent: "#ffd23f", bg1: "#1b1b2f", bg2: "#08080f", dim: 0.45, blur: 0, kenBurns: true, grain: 0.2, glow: 0.2, shake: 0, glitch: 0, intro: true, footer: true } },
  neon: { label: "Neon", style: { layout: "stack", font: "condensed", textCase: "upper", fontScale: 1.05, textColor: "#eafff4", accent: "#39ff88", bg1: "#2b0a3d", bg2: "#05010a", dim: 0.6, blur: 8, kenBurns: true, grain: 0.4, glow: 1, shake: 0.6, glitch: 0.35, intro: true, footer: true } },
  zine: { label: "Zin", style: { layout: "minimal", font: "serif", textCase: "normal", fontScale: 1, textColor: "#f3ead8", accent: "#e8b86d", bg1: "#2b2219", bg2: "#0d0a07", dim: 0.5, blur: 0, kenBurns: true, grain: 0.7, glow: 0, shake: 0, glitch: 0, intro: true, footer: false } },
};

export const CHORUS = ["Chorus", "Final Chorus", "Refrain", "Hook", "Refren"];

export function presetStyle(name: string, kind: Kind): Style {
  const base = PRESETS[name]?.style ?? PRESETS.night.style;
  // clips in a music video should stay visible behind the text
  const mv = kind === "music_video" ? { dim: Math.min(base.dim, 0.35), blur: 0 } : {};
  return { ...base, ...mv, badge: "", chorusSections: CHORUS };
}

export const LAYOUTS: Record<Style["layout"], string> = { stack: "Trzy linie (środek)", karaoke: "Karaoke (dół, wypełnianie)", kinetic: "Kinetyczny (słowo po słowie)", minimal: "Minimalny (jedna linia)" };
export const FONTS: Record<Style["font"], string> = { inter: "Inter", condensed: "Bebas (wąski)", serif: "Playfair (szeryf)", mono: "Mono", marker: "Marker (odręczny)" };

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const pick = <T extends string>(v: unknown, opts: readonly T[], d: T) => (opts.includes(v as T) ? (v as T) : d);

/** Any object → a valid Style (unknown keys dropped, numbers clamped); fallback fills the gaps */
export function cleanStyle(v: unknown, fallback: Style): Style {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const col = (k: keyof Style) => (typeof o[k] === "string" && HEX.test(o[k] as string) ? (o[k] as string).toLowerCase() : (fallback[k] as string));
  const bool = (k: keyof Style) => (typeof o[k] === "boolean" ? (o[k] as boolean) : (fallback[k] as boolean));
  return {
    layout: pick(o.layout, ["stack", "karaoke", "kinetic", "minimal"] as const, fallback.layout),
    font: pick(o.font, ["inter", "condensed", "serif", "mono", "marker"] as const, fallback.font),
    textCase: pick(o.textCase, ["normal", "upper", "lower"] as const, fallback.textCase),
    fontScale: num(o.fontScale, 0.6, 1.6, fallback.fontScale),
    textColor: col("textColor"), accent: col("accent"), bg1: col("bg1"), bg2: col("bg2"),
    dim: num(o.dim, 0, 1, fallback.dim), blur: num(o.blur, 0, 30, fallback.blur), kenBurns: bool("kenBurns"),
    grain: num(o.grain, 0, 1, fallback.grain), glow: num(o.glow, 0, 1, fallback.glow),
    shake: num(o.shake, 0, 1, fallback.shake), glitch: num(o.glitch, 0, 1, fallback.glitch),
    intro: bool("intro"), footer: bool("footer"),
    badge: typeof o.badge === "string" ? o.badge.slice(0, 40) : fallback.badge,
    chorusSections: Array.isArray(o.chorusSections) ? o.chorusSections.filter((x): x is string => typeof x === "string").slice(0, 8) : fallback.chorusSections,
  };
}

/** What a CMV job still needs before a render (Slowfall checks come from the pipeline's sync) */
export function cmvChecks(j: VideoJob): Check[] {
  const has = (r: Asset["role"]) => j.assets.some((a) => a.role === r);
  const c: Check[] = [
    { key: "audio", label: "Piosenka (MP3/WAV)", ok: has("audio"), required: true },
    { key: "lyrics", label: "Tekst piosenki", ok: has("timing") || !!j.params.lyrics?.trim(), required: true, hint: "Wklej tekst z [Verse]/[Chorus] albo wrzuć plik z timingami" },
  ];
  if (j.kind === "music_video") c.push({ key: "clips", label: "Klipy do teledysku", ok: has("clip"), required: true, hint: "Wrzuć klipy z Kling/MJ (każdy ≥ 3 s)" });
  else c.push({ key: "bg", label: "Tło (obraz lub wideo)", ok: has("background"), required: false, hint: "Bez tła: gradient z kolorów stylu" });
  return c;
}

export const checksOf = (j: VideoJob) => (j.brand === "cmv" ? cmvChecks(j) : j.checks);
export const blocked = (j: VideoJob) => checksOf(j).filter((c) => c.required !== false && !c.ok);

/** m:ss ↔ seconds for segment inputs */
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
export function parseMmss(v: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d{1,2}(?:\.\d+)?)\s*$/.exec(v);
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : null;
}

export const gb = (b?: number) => (b == null ? "" : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
