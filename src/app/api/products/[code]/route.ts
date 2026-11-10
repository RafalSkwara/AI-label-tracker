import { requireAnyRole } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/db";
import { FIELDS, mapProduct, type Product, SOURCES, validBarcode } from "@/lib/off";

// Open Food Facts asks for an app name and a contact in the User-Agent (rate limit: 15 product reads/min per IP).
const USER_AGENT = "SideHustleAssistant/1.0 (smartlife.dev.ai@gmail.com)";
const MISS_TTL_MS = 7 * 24 * 3600e3; // retry unknown codes after a week: the databases grow
const TIMEOUT_MS = 5000;

type Cached = { found: boolean; name: string | null; brand: string | null; quantity: string | null; source: Product["source"] | null; fetched_at: string };

/** Barcode lookup for the shopping list: the caller's own items → shared cache → OFF → OBF → OPF. Response: { product } or { product: null }. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const caller = await requireAnyRole(req);
  if (!caller) return Response.json({ error: "forbidden" }, { status: 403 });
  const { code } = await ctx.params;
  if (!validBarcode(code)) return Response.json({ error: "invalid barcode" }, { status: 400 });
  const db = serviceDb();

  // 1. What the user called this product before (also covers codes the databases do not know)
  const own = await db.from("shopping_items").select("name,quantity").eq("owner_id", caller.userId).eq("barcode", code)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (own.data) return Response.json({ product: { barcode: code, name: own.data.name, brand: null, quantity: own.data.quantity, source: "own" } satisfies Product });

  // 2. Shared cache
  const hit = await db.from("product_cache").select("found,name,brand,quantity,source,fetched_at").eq("barcode", code).maybeSingle<Cached>();
  if (hit.data?.found) return Response.json({ product: { barcode: code, name: hit.data.name!, brand: hit.data.brand, quantity: hit.data.quantity, source: hit.data.source! } });
  if (hit.data && Date.now() - Date.parse(hit.data.fetched_at) < MISS_TTL_MS) return Response.json({ product: null });

  // 3. Open Food Facts, then Open Beauty Facts, then Open Products Facts
  let product: Product | null = null;
  for (const s of SOURCES) {
    let res: Response;
    try {
      res = await fetch(`https://${s.host}/api/v2/product/${code}?fields=${FIELDS}`, {
        headers: { "user-agent": USER_AGENT, accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      console.error(`products ${s.id}:`, (e as Error).message);
      return Response.json({ error: "unavailable" }, { status: 503 });
    }
    if (res.status === 404) continue; // unknown product
    if (!res.ok) {
      console.error(`products ${s.id}: HTTP ${res.status}`);
      return Response.json({ error: "unavailable" }, { status: 503 }); // rate limit or outage: do not cache a miss
    }
    product = mapProduct(await res.json(), s.id);
    if (product) break;
  }

  const row: Omit<Cached, "source"> & { barcode: string; source: string | null } = product
    ? { barcode: code, found: true, name: product.name, brand: product.brand, quantity: product.quantity, source: product.source, fetched_at: new Date().toISOString() }
    : { barcode: code, found: false, name: null, brand: null, quantity: null, source: null, fetched_at: new Date().toISOString() };
  const { error } = await db.from("product_cache").upsert(row);
  if (error) console.error("products cache:", error.message);
  return Response.json({ product: product && { ...product, barcode: code } });
}
