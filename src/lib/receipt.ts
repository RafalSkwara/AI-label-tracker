// Receipt data shared by the Worker (AI output validation) and the app (matching with a shopping list).

export const CATEGORIES = {
  spozywcze: "Spożywcze",
  chemia: "Chemia i higiena",
  dom: "Dom",
  zdrowie: "Zdrowie",
  dzieci: "Dzieci",
  transport: "Transport",
  na_miescie: "Na mieście",
  rozrywka: "Rozrywka",
  inne: "Inne",
} as const;
export type Category = keyof typeof CATEGORIES;
export const isCategory = (v: unknown): v is Category => typeof v === "string" && v in CATEGORIES;

/** Receipt line; price = line total in PLN after discounts */
export type ReceiptItem = { name: string; quantity: string | null; price: number | null };
export type ReceiptRead = { shop: string | null; date: string | null; total: number | null; category: Category; items: ReceiptItem[] };

const money = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(",", ".").replace(/[^\d.-]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) / 100 : null;
};
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim().slice(0, max);
  return t || null;
};

/** Model output → safe values; anything unreadable becomes null so the user fills it in */
export function cleanRead(raw: unknown, today: string): ReceiptRead {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const items: ReceiptItem[] = [];
  for (const it of Array.isArray(r.items) ? r.items.slice(0, 200) : []) {
    const o = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    const name = text(o.name, 120);
    if (name) items.push({ name, quantity: text(o.quantity, 30), price: money(o.price) });
  }
  // a date in the future or more than a year back is a misread
  const d = typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  return {
    shop: text(r.shop, 80),
    date: d && d <= today && d >= yearAgo ? d : null,
    total: money(r.total),
    category: isCategory(r.category) ? r.category : "inne",
    items,
  };
}

/** Lowercase, no Polish diacritics, no sizes/percentages/codes: "Mleko UHT 3,2% 1L" → "mleko uht" */
export function normName(s: string): string {
  return s
    .toLocaleLowerCase("pl")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l")
    .replace(/\d+([.,]\d+)?\s*(%|kg|g|ml|l|szt|op)\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/).filter((w) => w.length > 1).join(" ");
}

/** Polish inflection: "jajka" ~ "jaja", "pomidory" ~ "pomidor" (common prefix of 3+ letters covering 75% of the shorter word) */
function sameStem(a: string, b: string): boolean {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n >= 3 && n >= 0.75 * Math.min(a.length, b.length);
}

/** Share of the list name's words that start a word on the receipt line (receipts abbreviate: "MLEKO ŁAC." vs "mleko łaciate") */
export function matchScore(listName: string, receiptName: string): number {
  const a = normName(listName).split(" ").filter(Boolean);
  const b = normName(receiptName).split(" ").filter(Boolean);
  if (!a.length || !b.length) return 0;
  const hit = a.filter((w) => b.some((x) => x.startsWith(w) || (x.length >= 3 && w.startsWith(x)) || sameStem(w, x)));
  return hit.length / a.length;
}

/** Best receipt line for each list item (each line used once), score ≥ 0.5 */
export function matchItems<T extends { id: string; name: string }>(list: T[], receipt: ReceiptItem[]): { item: T; line: number }[] {
  const pairs: { item: T; line: number; score: number }[] = [];
  for (const item of list) receipt.forEach((r, line) => {
    const score = matchScore(item.name, r.name);
    if (score >= 0.5) pairs.push({ item, line, score });
  });
  pairs.sort((x, y) => y.score - x.score);
  const usedItem = new Set<string>(), usedLine = new Set<number>(), out: { item: T; line: number }[] = [];
  for (const p of pairs) {
    if (usedItem.has(p.item.id) || usedLine.has(p.line)) continue;
    usedItem.add(p.item.id); usedLine.add(p.line); out.push({ item: p.item, line: p.line });
  }
  return out;
}
