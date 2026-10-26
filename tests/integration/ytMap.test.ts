import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { firstMondayOnOrAfter, mapAnalytics, mapReach, toWeeks } from "../../src/lib/ytMap";

const analytics = JSON.parse(readFileSync("tests/fixtures/yt-analytics.json", "utf8"));
const reach = readFileSync("tests/fixtures/reach.csv", "utf8");

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
});
