import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DistroKidFormatError, money, monthTotals, parseDistroKid, planImport, saleMonth } from "../../src/lib/distrokid";

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
    expect(money("0,5")).toBe(0.5);
    expect(money("")).toBeNull();
  });
});
