/**
 * DistroKid Bank export (CSV or TSV) -> royalties rows.
 * Columns are mapped by header name, so order and extra columns do not matter.
 * Pure functions only (hashing uses WebCrypto, available in browsers, Workers and Node).
 */

export class DistroKidFormatError extends Error {
  constructor(public missing: string[]) {
    super("Missing columns: " + missing.join(", "));
  }
}

/** A parsed export line, before the artist is mapped to a project */
export type ParsedRow = {
  artist: string;
  sale_month: string; // first day of the month, YYYY-MM-01
  store: string | null;
  title: string | null;
  isrc: string | null;
  country: string | null;
  quantity: number;
  earnings_usd: number;
  /** content key (includes Reporting Date, which is not stored) used for the import hash */
  key: string;
};

/** A row ready for the royalties table */
export type RoyaltyInsert = {
  project_id: string;
  sale_month: string;
  store: string | null;
  title: string | null;
  isrc: string | null;
  country: string | null;
  quantity: number;
  earnings_usd: number;
  import_hash: string;
};

export type ParseResult = { rows: ParsedRow[]; invalid: number };
export type SkippedArtist = { artist: string; count: number };
export type ImportPlan = { rows: RoyaltyInsert[]; skipped: SkippedArtist[]; invalid: number };

const HEADERS = {
  reporting: ["reporting date"],
  month: ["sale month"],
  store: ["store"],
  artist: ["artist"],
  title: ["title"],
  isrc: ["isrc"],
  quantity: ["quantity"],
  country: ["country of sale", "country"],
  earnings: ["earnings (usd)", "earnings"],
} as const;

const norm = (s: string) => s.replace(/^﻿/, "").trim().replace(/\s+/g, " ").toLowerCase();

/** Delimiter of the header line: the most frequent of tab, comma, semicolon outside quotes (tab wins ties) */
function detectDelimiter(text: string): string {
  const line = text.replace(/^﻿/, "").split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const count: Record<string, number> = { "\t": 0, ",": 0, ";": 0 };
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (!q && ch in count) count[ch]++;
  }
  return ([",", ";"] as const).reduce((best, d) => (count[d] > count[best] ? d : best), "\t");
}

/** RFC 4180-style tokenizer: quoted fields may hold the delimiter, newlines and doubled quotes */
export function tokenize(text: string, delim: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], field = "", q = false, i = 0;
  const s = text.replace(/^﻿/, "");
  const endRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0].trim() !== "") out.push(row);
    row = [];
  };
  while (i < s.length) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false;
      } else field += ch;
    } else if (ch === '"' && field === "") q = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n") endRow();
    else if (ch === "\r") { if (s[i + 1] === "\n") i++; endRow(); }
    else field += ch;
    i++;
  }
  if (field !== "" || row.length) endRow();
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "2026-09", "2026-09-01", "2026/09", "09/2026", "Sep 2026", "September 2026" -> "2026-09-01"; otherwise null */
export function saleMonth(raw: string): string | null {
  const s = raw.trim();
  const ok = (y: string, m: number) => (m >= 1 && m <= 12 && +y >= 2000 && +y <= 2100 ? `${y}-${String(m).padStart(2, "0")}-01` : null);
  let m = /^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?(?:[T ].*)?$/.exec(s);
  if (m) return ok(m[1], +m[2]);
  m = /^(\d{1,2})[-/](\d{4})$/.exec(s);
  if (m) return ok(m[2], +m[1]);
  m = /^([A-Za-z]{3,9})\.?,? (\d{4})$/.exec(s);
  if (m) { const idx = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); return idx >= 0 ? ok(m[2], idx + 1) : null; }
  return null;
}

/** "0.4821", "-0.02", "1,234.56", "0,5" -> number; empty or garbage -> null */
export function money(raw: string): number | null {
  let s = raw.trim().replace(/^\$/, "");
  if (s === "") return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  return /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s) ? Number(s) : null;
}

/** Parses the whole export; lines with an unreadable month, quantity or amount are counted in `invalid` */
export function parseDistroKid(text: string): ParseResult {
  const table = tokenize(text, detectDelimiter(text));
  if (!table.length) throw new DistroKidFormatError(["Sale Month", "Artist", "Earnings (USD)"]);
  const head = table[0].map(norm);
  const col = (names: readonly string[]) => head.findIndex((h) => names.includes(h));
  const idx = Object.fromEntries(Object.entries(HEADERS).map(([k, v]) => [k, col(v)])) as Record<keyof typeof HEADERS, number>;
  const missing = ([["month", "Sale Month"], ["artist", "Artist"], ["earnings", "Earnings (USD)"]] as const).filter(([k]) => idx[k] < 0).map(([, n]) => n);
  if (missing.length) throw new DistroKidFormatError(missing);

  const get = (r: string[], k: keyof typeof HEADERS) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");
  const opt = (v: string) => (v === "" ? null : v);
  const rows: ParsedRow[] = [];
  let invalid = 0;
  for (const r of table.slice(1)) {
    const month = saleMonth(get(r, "month")), earnings = money(get(r, "earnings"));
    const qRaw = get(r, "quantity"), q = qRaw === "" ? 0 : money(qRaw);
    if (!month || earnings == null || q == null) { invalid++; continue; }
    const row = {
      artist: get(r, "artist"), sale_month: month, store: opt(get(r, "store")), title: opt(get(r, "title")),
      isrc: opt(get(r, "isrc")), country: opt(get(r, "country")), quantity: Math.round(q), earnings_usd: earnings,
    };
    rows.push({ ...row, key: [get(r, "reporting"), month, row.store, row.artist, row.title, row.isrc, row.quantity, row.country, earnings].join("\u001f") });
  }
  return { rows, invalid };
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const artistKey = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Maps artists to projects and hashes every row. Identical lines inside one file get an occurrence
 * number, so they stay distinct but the same file always yields the same hashes (re-import adds nothing).
 * Unknown artists are skipped and counted.
 */
export async function planImport(parsed: ParseResult, projects: { id: string; distrokid_artist: string | null }[]): Promise<ImportPlan> {
  const byArtist = new Map<string, string>();
  for (const p of projects) if (p.distrokid_artist && !byArtist.has(artistKey(p.distrokid_artist))) byArtist.set(artistKey(p.distrokid_artist), p.id);
  const seen = new Map<string, number>(), skipped = new Map<string, number>(), rows: RoyaltyInsert[] = [];
  for (const r of parsed.rows) {
    const pid = byArtist.get(artistKey(r.artist));
    if (!pid) { const name = r.artist || "(brak artysty)"; skipped.set(name, (skipped.get(name) ?? 0) + 1); continue; }
    const n = (seen.get(r.key) ?? 0) + 1;
    seen.set(r.key, n);
    rows.push({
      project_id: pid, sale_month: r.sale_month, store: r.store, title: r.title, isrc: r.isrc, country: r.country,
      quantity: r.quantity, earnings_usd: r.earnings_usd, import_hash: await sha256(r.key + "\u001e" + n),
    });
  }
  return { rows, skipped: [...skipped].map(([artist, count]) => ({ artist, count })), invalid: parsed.invalid };
}

/** A line of v_royalties_month (or of royalties itself) */
export type MonthLine = { project_id: string; sale_month: string; title: string | null; quantity: number; earnings_usd: number };
export type MonthTotal = { project_id: string; month: string; quantity: number; usd: number; tracks: { title: string; quantity: number; usd: number }[] };

/** Totals per project and month (newest month first) with tracks ordered by revenue, then streams */
export function monthTotals(lines: MonthLine[]): MonthTotal[] {
  const map = new Map<string, MonthTotal>();
  for (const l of lines) {
    const month = l.sale_month.slice(0, 7), k = l.project_id + "|" + month;
    const t = map.get(k) ?? { project_id: l.project_id, month, quantity: 0, usd: 0, tracks: [] };
    const q = Number(l.quantity), usd = Number(l.earnings_usd), title = l.title || "(bez tytułu)";
    t.quantity += q;
    t.usd += usd;
    const tr = t.tracks.find((x) => x.title === title);
    if (tr) { tr.quantity += q; tr.usd += usd; } else t.tracks.push({ title, quantity: q, usd });
    map.set(k, t);
  }
  for (const t of map.values()) t.tracks.sort((a, b) => b.usd - a.usd || b.quantity - a.quantity);
  return [...map.values()].sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
}
