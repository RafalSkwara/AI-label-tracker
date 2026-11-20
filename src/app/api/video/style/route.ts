import { getCloudflareContext } from "@opennextjs/cloudflare";
import { ownerDb } from "@/lib/server/auth";
import { cleanStyle, FONTS, LAYOUTS, presetStyle, type Style } from "@/lib/video";

// Workers AI (Cloudflare account, no external key); same model as the receipt reader
const MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
type Ai = { run(model: string, input: unknown): Promise<unknown> };

const PROMPT = `You style lyric videos for a pop-punk band. Turn the user's instructions (often in Polish) into the JSON style of a Remotion template.
Start from the current style and change only what the instructions ask for or clearly imply. Fields:
- layout: ${Object.entries(LAYOUTS).map(([k, v]) => `${k} (${v})`).join(", ")}
- font: ${Object.entries(FONTS).map(([k, v]) => `${k} (${v})`).join(", ")}
- textCase: normal | upper | lower; fontScale: 0.6–1.6
- textColor, accent (sung word, chorus, glow), bg1, bg2 (background gradient when there is no image): hex #rrggbb
- dim 0–1 (darkening of the background image/clips), blur 0–30 px
- kenBurns: slow zoom on a still background
- grain, glow, shake (chorus camera shake), glitch (RGB split on the chorus): 0–1
- intro (title card), footer (artist — title + progress line): booleans
- badge: short text in a pill at the top, "" for none
Return JSON only: {"style": {...all fields...}, "note": "one short sentence in Polish saying what you changed"}.`;

function parseJson(v: unknown): unknown {
  if (v && typeof v === "object" && "response" in v) v = (v as { response: unknown }).response;
  if (typeof v !== "string") return v;
  const a = v.indexOf("{"), b = v.lastIndexOf("}");
  return a >= 0 && b > a ? JSON.parse(v.slice(a, b + 1)) : null;
}

/** POST { instructions, style, kind } → { style, note }: the instructions applied to the style, validated */
export async function POST(req: Request) {
  if (!(await ownerDb(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { instructions?: unknown; style?: unknown; kind?: unknown } | null;
  const instructions = typeof body?.instructions === "string" ? body.instructions.trim().slice(0, 2000) : "";
  if (!instructions) return Response.json({ error: "brak instrukcji" }, { status: 400 });
  const current = cleanStyle(body?.style, presetStyle("night", body?.kind === "music_video" ? "music_video" : "lyric"));
  const ai = (getCloudflareContext().env as unknown as { AI?: Ai }).AI;
  if (!ai) return Response.json({ error: "AI niedostępne" }, { status: 503 });
  try {
    const out = await ai.run(MODEL, {
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: `Current style: ${JSON.stringify(current)}\nVideo type: ${String(body?.kind ?? "lyric")}\nInstructions: ${instructions}` },
      ],
      response_format: { type: "json_object" },
      max_tokens: 900,
      temperature: 0.2,
    });
    const parsed = parseJson(out) as { style?: unknown; note?: unknown } | null;
    const style: Style = cleanStyle(parsed?.style ?? parsed, current);
    return Response.json({ style, note: typeof parsed?.note === "string" ? parsed.note.slice(0, 200) : "" });
  } catch (e) {
    return Response.json({ error: `AI: ${(e as Error).message}` }, { status: 502 });
  }
}
