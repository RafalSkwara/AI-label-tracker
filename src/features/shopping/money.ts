const PLN = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });

export const fmtPrice = (v: number) => PLN.format(v);

/** "12,5" / "12.50 zł" → 12.5; "" → null; anything else → undefined (invalid) */
export function parsePrice(s: string): number | null | undefined {
  const t = s.replace(/zł/i, "").replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 && v < 100000 ? Math.round(v * 100) / 100 : undefined;
}

export const sumPrices = (items: { price: number | null }[]) => items.reduce((a, i) => a + (i.price ?? 0), 0);
