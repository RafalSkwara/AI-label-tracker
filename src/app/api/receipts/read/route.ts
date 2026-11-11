import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAnyRole } from "@/lib/server/auth";
import { CATEGORIES, cleanRead } from "@/lib/receipt";
import { localToday } from "@/lib/calendar";

// Workers AI vision model (Cloudflare-hosted, billed per token on the account; no external API key)
const MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
const MAX_IMAGE_CHARS = 1_500_000; // data URL; the app sends a JPEG of at most ~1600 px

type Ai = { run(model: string, input: unknown): Promise<unknown> };

const SCHEMA = {
  type: "object",
  properties: {
    shop: { type: ["string", "null"] },
    date: { type: ["string", "null"] },
    total: { type: ["number", "null"] },
    category: { type: "string", enum: Object.keys(CATEGORIES) },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, quantity: { type: ["string", "null"] }, price: { type: ["number", "null"] } },
        required: ["name", "quantity", "price"],
      },
    },
  },
  required: ["shop", "date", "total", "category", "items"],
};

const PROMPT = `You read a photo of a Polish shop receipt (paragon fiskalny) and return JSON only.
- shop: the shop or chain name as people say it (e.g. "Biedronka", "Lidl", "Rossmann"), not the company's legal name.
- date: purchase date as YYYY-MM-DD.
- total: the amount paid, from the "SUMA PLN" / "DO ZAPŁATY" line.
- items: one entry per product line, in receipt order. name: the product name tidied up in Polish (fix ALL CAPS to normal case, keep the brand, no tax letters, codes or prices). quantity: e.g. "2 szt", "0,456 kg", or null for a single piece. price: the line total in PLN after any discount ("Rabat", "Opust") printed under it. Skip returned-deposit lines ("zwrot kaucji"); shopping bags are items.
- category: the best fit for the whole receipt: ${Object.entries(CATEGORIES).map(([k, v]) => `${k} (${v})`).join(", ")}.
Use null for anything you cannot read. Never invent products.`;

/** Object from the model: already parsed, or text that may be wrapped in a code fence or prose */
function parseJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const a = v.indexOf("{"), b = v.lastIndexOf("}");
  return a >= 0 && b > a ? JSON.parse(v.slice(a, b + 1)) : null;
}

/** POST { image: "data:image/jpeg;base64,..." } → ReceiptRead. The photo is not stored here (the app uploads it to Storage). */
export async function POST(req: Request) {
  const me = await requireAnyRole(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { image?: unknown } | null;
  const image = body?.image;
  if (typeof image !== "string" || !/^data:image\/(jpeg|webp);base64,/.test(image) || image.length > MAX_IMAGE_CHARS) {
    return Response.json({ error: "invalid image" }, { status: 400 });
  }
  const ai = (getCloudflareContext().env as unknown as { AI?: Ai }).AI;
  if (!ai) return Response.json({ error: "ai unavailable" }, { status: 503 });
  const messages = [
    { role: "system", content: PROMPT },
    { role: "user", content: [{ type: "text", text: "Read this receipt." }, { type: "image_url", image_url: { url: image } }] },
  ];
  try {
    let out: { response?: unknown };
    try {
      out = (await ai.run(MODEL, { messages, response_format: { type: "json_schema", json_schema: SCHEMA }, max_tokens: 4096, temperature: 0 })) as typeof out;
    } catch (e) {
      // structured output with an image is not supported by every model version: ask for plain JSON text instead
      console.error("receipt read (json mode):", (e as Error).message);
      out = (await ai.run(MODEL, { messages, max_tokens: 4096, temperature: 0 })) as typeof out;
    }
    return Response.json(cleanRead(parseJson(out.response), localToday()));
  } catch (e) {
    console.error("receipt read:", (e as Error).message);
    return Response.json({ error: "read failed" }, { status: 502 });
  }
}
