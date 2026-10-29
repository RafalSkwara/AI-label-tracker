import type { SupplyItem } from "./types";

type Eff = { min: number; max: number; own: boolean };

export function effective(i: SupplyItem): Eff | null {
  if (i.own_price != null) return { min: i.own_price, max: i.own_price, own: true };
  if (i.price_min != null) return { min: i.price_min, max: i.price_max ?? i.price_min, own: false };
  return null;
}

export function sum(items: SupplyItem[]): [number, number] {
  let lo = 0, hi = 0;
  for (const i of items) {
    const e = effective(i);
    if (e) { lo += e.min; hi += e.max; }
  }
  return [lo, hi];
}

const nf = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 });

export function fmtRange(min: number, max: number): string {
  return min === max ? `${nf.format(min)} zł` : `${nf.format(min)}–${nf.format(max)} zł`;
}

/** Case- and diacritics-insensitive form for search */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").toLowerCase();
}
