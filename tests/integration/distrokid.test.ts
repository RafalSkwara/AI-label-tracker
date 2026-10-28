import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DistroKidFormatError, money, monthTotals, parseDistroKid, planImport, reportingDate, saleMonth } from "../../src/lib/distrokid";

const csv = readFileSync("tests/fixtures/distrokid.csv", "utf8");
const projects = [
  { id: "p-cmv", distrokid_artist: "Contents May Vary" },
  { id: "p-elk", distrokid_artist: "Elektronika" },
  { id: "p-slow", distrokid_artist: null },
];

describe("DistroKid CSV import", () => {
  it("parses quoted fields with commas and doubled quotes", () => {
    const { rows, invalid } = parseDistroKid(csv);
    expect(invalid).toBe(0);
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({ artist: "Contents May Vary", sale_month: "2026-09-01", store: "Spotify", title: "Hello, World", isrc: "QZ1234500001", country: "US", quantity: 120, earnings_usd: 0.4821 });
    expect(rows[2].title).toBe('The "Quiet" Hours');
  });

  it("maps artists to projects, skips and reports unknown artists", async () => {
    const plan = await planImport(parseDistroKid(csv), projects);
    expect(plan.rows).toHaveLength(7);
    expect(plan.skipped).toEqual([{ artist: "Some Other Artist", count: 2 }]);
    expect(plan.rows.filter((r) => r.project_id === "p-elk")).toHaveLength(1);
    expect(plan.rows.every((r) => r.project_id !== "p-slow")).toBe(true);
  });

  it("gives the right monthly totals per project", async () => {
    const plan = await planImport(parseDistroKid(csv), projects);
    const totals = monthTotals(plan.rows);
    const cmvSep = totals.find((t) => t.project_id === "p-cmv" && t.month === "2026-09")!;
    expect(cmvSep.quantity).toBe(770);
    expect(cmvSep.usd).toBeCloseTo(2.7955, 6);
    expect(cmvSep.tracks.map((t) => t.title)).toEqual(["Night Drive", "Hello, World", 'The "Quiet" Hours']);
    const cmvAug = totals.find((t) => t.project_id === "p-cmv" && t.month === "2026-08")!;
    expect(cmvAug.quantity).toBe(80);
    expect(cmvAug.usd).toBeCloseTo(0.3, 6);
    expect(totals.find((t) => t.project_id === "p-elk")).toMatchObject({ month: "2026-09", quantity: 50, usd: 0.2 });
    expect(totals.map((t) => t.month + t.project_id)).toEqual(["2026-09p-cmv", "2026-09p-elk", "2026-08p-cmv"]);
  });

  it("re-import adds nothing: identical lines stay distinct, the same file hashes the same", async () => {
    const first = await planImport(parseDistroKid(csv), projects);
    expect(new Set(first.rows.map((r) => r.import_hash)).size).toBe(first.rows.length); // the repeated Night Drive line is kept
    const stored = new Set(first.rows.map((r) => r.import_hash));
    const again = await planImport(parseDistroKid(csv), projects);
    expect(again.rows.filter((r) => !stored.has(r.import_hash))).toHaveLength(0);
  });

  it("maps columns by header name: any order, extra columns, TSV, BOM, CRLF", async () => {
    const tsv =
      "﻿UPC\tEarnings (USD)\tArtist\tSong/Album\tSale Month\tQuantity\tTitle\r\n" +
      '123\t0.5\tElektronika\tSong\t2026-09-01\t5\t"Dot, dash"\r\n' +
      "123\t1,234.50\tElektronika\tSong\tSep 2026\t7\tPulse\r\n";
    const { rows, invalid } = parseDistroKid(tsv);
    expect(invalid).toBe(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ artist: "Elektronika", sale_month: "2026-09-01", title: "Dot, dash", quantity: 5, earnings_usd: 0.5, store: null, isrc: null });
    expect(rows[1]).toMatchObject({ earnings_usd: 1234.5, sale_month: "2026-09-01" });
    expect((await planImport({ rows, invalid }, projects)).rows).toHaveLength(2);
  });

  it("matches artists regardless of case and spacing; counts unreadable lines as invalid", async () => {
    const text = "Sale Month,Artist,Earnings (USD),Quantity\n2026-09,  contents  may VARY ,0.1,1\nnot-a-month,Contents May Vary,0.1,1\n2026-09,Contents May Vary,abc,1\n";
    const parsed = parseDistroKid(text);
    expect(parsed.invalid).toBe(2);
    expect((await planImport(parsed, projects)).rows).toHaveLength(1);
  });

  it("rejects a file without the required columns", () => {
    expect(() => parseDistroKid("Foo,Bar\n1,2\n")).toThrow(DistroKidFormatError);
    try { parseDistroKid("Foo,Bar\n1,2\n"); } catch (e) { expect((e as DistroKidFormatError).missing).toEqual(["Sale Month", "Artist", "Earnings (USD)"]); }
  });

  it("normalizes months and amounts", () => {
    expect(saleMonth("2026-09")).toBe("2026-09-01");
    expect(saleMonth("2026-09-15")).toBe("2026-09-01");
    expect(saleMonth("09/2026")).toBe("2026-09-01");
    expect(saleMonth("September 2026")).toBe("2026-09-01");
    expect(saleMonth("2026-13")).toBeNull();
    expect(money("-0.02")).toBe(-0.02);
    expect(money("1,234.56")).toBe(1234.56);
    expect(money("")).toBeNull();
  });

  it("decides the decimal mark per file: a comma is thousands only in real groups, decimal in ';' files", async () => {
    // dot-decimal files: "0,123" is not a thousands group, so it is rejected instead of guessed; "1,050" is 1050
    expect(money("0,123")).toBeNull();
    expect(money("0,5")).toBeNull();
    expect(money("1,050")).toBe(1050);
    expect(money("12,345.6")).toBe(12345.6);
    // ';' files (Polish Excel): comma is the decimal mark, three decimals included
    expect(money("0,123", ",")).toBe(0.123);
    expect(money("1,050", ",")).toBe(1.05);
    expect(money("1.234,56", ",")).toBe(1234.56);
    expect(money("1 234,56", ",")).toBe(1234.56);
    const text = "Sale Month;Artist;Title;Earnings (USD);Quantity\n2026-09;Elektronika;\"Dot; dash\";0,482;1\n2026-09;Elektronika;Pulse;1,050;12\n";
    const { rows, invalid } = parseDistroKid(text);
    expect(invalid).toBe(0);
    expect(rows.map((r) => r.earnings_usd)).toEqual([0.482, 1.05]);
    expect(rows[0].title).toBe("Dot; dash");
    // the same text in a comma-delimited file is flagged invalid rather than read as ×1000
    expect(parseDistroKid("Sale Month,Artist,Earnings (USD)\n2026-09,Elektronika,\"0,482\"\n").invalid).toBe(1);
  });

  it("a cumulative export that contains an older one adds only the new lines", async () => {
    const old = await planImport(parseDistroKid(csv), projects);
    const stored = new Set(old.rows.map((r) => r.import_hash));
    const newer = csv.trimEnd() +
      "\n2026-11-14,2026-10,Spotify,Contents May Vary,Night Drive,QZ1234500003,300,GB,1.0500" + // a third identical line
      "\n2026-11-14,2026-10,Spotify,Elektronika,Signal Path,QZ1234500004,60,US,0.2400\n";
    const next = await planImport(parseDistroKid(newer), projects);
    expect(next.rows).toHaveLength(old.rows.length + 2);
    expect(next.rows.filter((r) => !stored.has(r.import_hash))).toHaveLength(2);
  });

  it("identical lines that are not adjacent are numbered per content, so order does not matter", async () => {
    const head = "Reporting Date,Sale Month,Store,Artist,Title,ISRC,Quantity,Country of Sale,Earnings (USD)\n";
    const a = "2026-10-14,2026-09,Spotify,Elektronika,Pulse,Q1,5,US,0.1", b = "2026-10-14,2026-09,Spotify,Elektronika,Drift,Q2,7,US,0.2";
    const one = await planImport(parseDistroKid(head + [a, b, a].join("\n")), projects);
    const two = await planImport(parseDistroKid(head + [a, a, b].join("\n")), projects);
    expect(new Set(one.rows.map((r) => r.import_hash)).size).toBe(3);
    expect(new Set(two.rows.map((r) => r.import_hash))).toEqual(new Set(one.rows.map((r) => r.import_hash)));
  });

  it("hashes a re-saved file the same: Reporting Date in another format, space before an opening quote", async () => {
    const head = "Reporting Date,Sale Month,Store,Artist,Title,ISRC,Quantity,Country of Sale,Earnings (USD)\n";
    const iso = await planImport(parseDistroKid(head + '2026-10-14,2026-09,Spotify,Elektronika,"Dot, dash",Q1,5,US,0.1\n'), projects);
    const dotted = await planImport(parseDistroKid(head + '14.10.2026,2026-09,Spotify,Elektronika, "Dot, dash",Q1,5,US,0.1\n'), projects);
    expect(dotted.rows).toHaveLength(1);
    expect(dotted.rows[0].title).toBe("Dot, dash");
    expect(dotted.rows[0].import_hash).toBe(iso.rows[0].import_hash);
    expect(reportingDate("10/14/2026")).toBe("2026-10-14");
    expect(reportingDate("14/10/2026")).toBe("2026-10-14");
    expect(reportingDate("2026-10-14T00:00:00Z")).toBe("2026-10-14");
    expect(reportingDate("whenever")).toBe("whenever");
  });
});
