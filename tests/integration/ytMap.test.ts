import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { firstMondayOnOrAfter, groupTraffic, mapAnalytics, mapReach, mapSearchTerms, mapStats, mapTraffic, toWeeks } from "../../src/lib/ytMap";

const analytics = JSON.parse(readFileSync("tests/fixtures/yt-analytics.json", "utf8"));
const reach = readFileSync("tests/fixtures/reach.csv", "utf8");
const fixture = (n: string) => JSON.parse(readFileSync(`tests/fixtures/${n}.json`, "utf8"));

describe("YouTube mapping", () => {
  it("maps Analytics rows to the Analytics columns only", () => {
    const rows = mapAnalytics(analytics);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ yt_video_id: "Y1zTI-zy9HA", date: "2026-10-12", views: 100, watch_minutes: 600, subs_net: 2, avd_sec: 360 });
    expect(rows[0]).not.toHaveProperty("impressions");
    expect(rows[0]).not.toHaveProperty("ctr_pct");
  });

  it("maps the Reach CSV to the Reach columns only: ISO dates, CTR as a percent, rows without a video skipped", () => {
    const rows = mapReach(reach);
    expect(rows).toEqual([
      { yt_video_id: "Y1zTI-zy9HA", date: "2026-10-12", impressions: 1000, ctr_pct: 5 },
      { yt_video_id: "yL4czbAFQ54", date: "2026-10-12", impressions: 500, ctr_pct: 2 },
      // two CSV lines for the same video-day (200 at 4% + 300 at 2%) collapse to one row, impression-weighted
      { yt_video_id: "Y1zTI-zy9HA", date: "2026-10-19", impressions: 500, ctr_pct: 2.8 },
    ]);
    expect(rows[0]).not.toHaveProperty("views");
  });

  it("builds Monday weeks: minutes to hours, weighted AVD and CTR, null where a metric has no data", () => {
    const weeks = toWeeks([...mapAnalytics(analytics), ...mapReach(reach)]);
    expect(weeks.map((w) => w.week_start)).toEqual(["2026-10-12", "2026-10-19"]);
    // 12.10 (Mon) and 18.10 (Sun) share a week: views 100+50+100, minutes 600+150+300 = 1050 → 17.5 h, subs (2)+(0)+(-1)
    expect(weeks[0]).toEqual({
      week_start: "2026-10-12", views: 250, watch_hours: 17.5, subs_net: 1,
      avd_min: 4.2, // (360·100 + 180·50 + 180·100) / 250 s = 252 s
      impressions: 1500, ctr_pct: 4, // (1000·5% + 500·2%) / 1500
    });
    // week of 19.10: views 100, minutes 360 → 6 h, AVD (180·40 + 240·60) / 100 = 216 s; one reach row of 200 impressions at 4%
    expect(weeks[1]).toEqual({ week_start: "2026-10-19", views: 100, watch_hours: 6, subs_net: 2, avd_min: 3.6, impressions: 500, ctr_pct: 2.8 });
    expect(toWeeks(mapAnalytics(analytics))[0]).toMatchObject({ impressions: null, ctr_pct: null });
  });

  it("skips weeks the Analytics window cuts in half and weeks that have only Reach rows", () => {
    const rows = [...mapAnalytics(analytics), ...mapReach(reach)];
    // window starts Wed 14.10 → first full Monday is 19.10; the 12.10 week is partial and must not be written
    expect(firstMondayOnOrAfter("2026-10-14")).toBe("2026-10-19");
    expect(firstMondayOnOrAfter("2026-10-19")).toBe("2026-10-19");
    expect(toWeeks(rows, "2026-10-19").map((w) => w.week_start)).toEqual(["2026-10-19"]);
    // Reach rows alone (backfill older than the Analytics window) produce no week, not a week of zeros
    expect(toWeeks(mapReach(reach))).toEqual([]);
  });

  it("maps traffic sources by header name and groups them into the six display groups", () => {
    const rows = mapTraffic(fixture("yt-traffic"));
    expect(rows[0]).toEqual({ source_type: "RELATED_VIDEO", views: 120, watch_minutes: 400 });
    expect(rows).toHaveLength(8);
    const g = Object.fromEntries(groupTraffic(rows).map((x) => [x.group, x.views]));
    // external = EXT_URL + NO_LINK_OTHER; "Inne" = YT_CHANNEL + SHORTS
    expect(g).toEqual({ Sugerowane: 120, Wyszukiwarka: 60, Przeglądanie: 30, Zewnętrzne: 10, Playlisty: 10, Inne: 10 });
    expect(groupTraffic(rows).reduce((a, x) => a + x.share, 0)).toBeCloseTo(1);
    expect(groupTraffic([]).every((x) => x.share === 0)).toBe(true);
  });

  it("maps search terms and drops blank terms", () => {
    expect(mapSearchTerms(fixture("yt-search-terms"))).toEqual([
      { term: "rain sounds for sleep", views: 22 }, { term: "slow fall scenes", views: 20 }, { term: "autumn ambience", views: 9 },
    ]);
    // "slow fall scenes " (trailing space) merges into "slow fall scenes": 14 + 6
    expect(mapSearchTerms({ columnHeaders: [{ name: "insightTrafficSourceDetail" }, { name: "views" }], rows: null })).toEqual([]);
  });

  it("finds traffic columns by header name when the order differs, and throws when the dimension is missing", () => {
    const reordered = { columnHeaders: [{ name: "estimatedMinutesWatched" }, { name: "insightTrafficSourceType" }, { name: "views" }], rows: [[40, "YT_SEARCH", 7]] };
    expect(mapTraffic(reordered)).toEqual([{ source_type: "YT_SEARCH", views: 7, watch_minutes: 40 }]);
    expect(() => mapTraffic({ columnHeaders: [{ name: "views" }], rows: [[1]] })).toThrow(/insightTrafficSourceType/);
  });

  it("maps public counters: strings to numbers, hidden likes/comments to null, videos without statistics skipped", () => {
    expect(mapStats(fixture("yt-stats"))).toEqual([
      { yt_video_id: "Y1zTI-zy9HA", view_count: 1234, like_count: 56, comment_count: 7 },
      { yt_video_id: "yL4czbAFQ54", view_count: 98, like_count: null, comment_count: null },
    ]);
  });
});
