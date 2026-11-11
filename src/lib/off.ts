/** Open Food Facts family (ODbL): https://world.openfoodfacts.org/data. Shared by the Worker route and tests. */

export type ProductSource = "off" | "obf" | "opf";
export type Product = { barcode: string; name: string; brand: string | null; quantity: string | null; source: ProductSource | "own" };

export const SOURCES: { id: ProductSource; host: string; label: string }[] = [
  { id: "off", host: "world.openfoodfacts.org", label: "Open Food Facts" },
  { id: "obf", host: "world.openbeautyfacts.org", label: "Open Beauty Facts" },
  { id: "opf", host: "world.openproductsfacts.org", label: "Open Products Facts" },
];

export const FIELDS = "code,lang,product_name,product_name_pl,abbreviated_product_name_pl,generic_name_pl,product_name_en,generic_name_en,brands,quantity";

/** EAN-8, EAN-13, UPC-A (12), GTIN-14 with a valid check digit */
export function validBarcode(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const d = code.split("").map(Number), check = d.pop()!;
  const sum = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const clean = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** API v2 product response → Product, or null when the product is unknown or has no usable name */
export function mapProduct(json: unknown, source: ProductSource): Product | null {
  const r = json as { status?: number; code?: string; product?: Record<string, unknown> };
  if (r?.status !== 1 || !r.product) return null;
  const p = r.product;
  // Polish first, then English, then the product's main-language name (often Romanian, German… for imports)
  const name = clean(p.product_name_pl) || clean(p.abbreviated_product_name_pl) || clean(p.generic_name_pl)
    || clean(p.product_name_en) || clean(p.generic_name_en) || clean(p.product_name);
  if (!name) return null;
  const brand = clean(p.brands).split(",")[0]?.trim() || null;
  return { barcode: clean(p.code) || clean(r.code), name, brand, quantity: clean(p.quantity) || null, source };
}

/** "Mleko 2%" + "Mlekovita" → "Mleko 2% Mlekovita"; the brand is skipped when the name already has it */
export function displayName(p: Pick<Product, "name" | "brand">): string {
  if (!p.brand || p.name.toLocaleLowerCase("pl").includes(p.brand.toLocaleLowerCase("pl"))) return p.name;
  return `${p.name} ${p.brand}`;
}

export const productUrl = (source: ProductSource, barcode: string) =>
  `https://${SOURCES.find((s) => s.id === source)!.host}/product/${barcode}`;
