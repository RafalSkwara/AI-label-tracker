import { requireAnyRole } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/db";
import { displayName, FIELDS, mapProduct, type Product, SOURCES, validBarcode } from "@/lib/off";

// Open Food Facts asks for an app name and a contact in the User-Agent (rate limit: 15 product reads/min per IP).
const USER_AGENT = "SideHustleAssistant/1.0 (smartlife.dev.ai@gmail.com)";
const MISS_TTL_MS = 7 * 24 * 3600e3; // retry unknown codes after a week: the databases grow
const TIMEOUT_MS = 5000;

type Cached = { found: boolean; name: string | null; brand: string | null; quantity: string | null; source: Product["source"] | null; fetched_at: string };

/** Rows cached before this date used an older name choice (main language over Polish/English): refetch them */
const CACHE_VALID_FROM = Date.parse("2026-11-11T00:00:00Z");

/**
 * Barcode lookup for the shopping list: shared cache → OFF → OBF → OPF, then the caller's own items.
 * The caller's own name wins when they renamed the product (it differs from the database name) or the databases do not know the code.
 * Response: { product } or { product: null }.
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const caller = await requireAnyRole(req);
  if (!caller) return Response.json({ error: "forbidden" }, { status: 403 });
  const { code } = await ctx.params;
  if (!validBarcode(code)) return Response.json({ error: "invalid barcode" }, { status: 400 });
  const db = serviceDb();

  const ownQ = db.from("shopping_items").select("name,quantity").eq("owner_id", caller.userId).eq("barcode", code)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const [{ product: found, previous }, own] = await Promise.all([fromDatabases(db, code), ownQ]);
  const mine: Product | null = own.data ? { barcode: code, name: own.data.name, brand: null, quantity: own.data.quantity, source: "own" } : null;
  if (found === "unavailable") return mine ? Response.json({ product: mine }) : Response.json({ error: "unavailable" }, { status: 503 });
  // a name equal to what a database once suggested is not the user's own: prefer the current suggestion
  const renamed = mine && (!found || (mine.name !== displayName(found) && mine.name !== previous));
  return Response.json({ product: renamed ? mine : found });
}

/** Cache, then the Open Food Facts family; caches the result. "unavailable" on rate limit/outage (not cached). */
async function fromDatabases(db: ReturnType<typeof serviceDb>, code: string): Promise<{ product: Product | null | "unavailable"; previous: string | null }> {
  const hit = await db.from("product_cache").select("found,name,brand,quantity,source,fetched_at").eq("barcode", code).maybeSingle<Cached>();
  const fetchedAt = hit.data ? Date.parse(hit.data.fetched_at) : 0;
  const previous = hit.data?.found ? displayName({ name: hit.data.name!, brand: hit.data.brand }) : null;
  if (hit.data?.found && fetchedAt >= CACHE_VALID_FROM) return { previous, product: { barcode: code, name: hit.data.name!, brand: hit.data.brand, quantity: hit.data.quantity, source: hit.data.source! } };
  if (hit.data && !hit.data.found && Date.now() - fetchedAt < MISS_TTL_MS) return { previous, product: null };

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
      return { previous, product: "unavailable" };
    }
    if (res.status === 404) continue; // unknown product
    if (!res.ok) {
      console.error(`products ${s.id}: HTTP ${res.status}`);
      return { previous, product: "unavailable" }; // rate limit or outage: do not cache a miss
    }
    product = mapProduct(await res.json(), s.id);
    if (product) break;
  }

  const row: Omit<Cached, "source"> & { barcode: string; source: string | null } = product
    ? { barcode: code, found: true, name: product.name, brand: product.brand, quantity: product.quantity, source: product.source, fetched_at: new Date().toISOString() }
    : { barcode: code, found: false, name: null, brand: null, quantity: null, source: null, fetched_at: new Date().toISOString() };
  const { error } = await db.from("product_cache").upsert(row);
  if (error) console.error("products cache:", error.message);
  return { previous, product: product && { ...product, barcode: code } };
}
