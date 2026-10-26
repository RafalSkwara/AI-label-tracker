export type Task = {
  id: string;
  title: string;
  phase: "F0" | "F1" | "F2" | "F3";
  due: string | null;
  note: string | null;
  done: boolean;
  done_at: string | null;
  project_id: string | null;
};

export type Item = {
  id: string;
  project_id: string | null;
  title: string;
  kind: "film" | "EP" | "short";
  status: "pomysł" | "produkcja" | "zaplanowany" | "live";
  publish_date: string | null;
  url: string | null;
  yt_video_id: string | null;
  note: string | null;
  live_at: string | null;
  updated_at: string;
};

export type Week = {
  project_id: string;
  week_start: string;
  uploads: number | null;
  views: number | null;
  watch_hours: number | null;
  subs_net: number | null;
  impressions: number | null;
  ctr_pct: number | null;
  avd_min: number | null;
  revenue_pln: number | null;
  note: string | null;
  source: "manual" | "yt_api";
};

export type Sub = {
  id: string;
  name: string;
  plan: string | null;
  price: number;
  currency: "USD" | "PLN";
  cycle: "mies" | "rok";
  status: "aktywna" | "planowana" | "anulowana";
  renew: string | null;
  started_at: string | null;
  paid_until: string | null;
  plan_details: string | null;
  dashboard_url: string | null;
  note: string | null;
  project_id: string | null;
};

export type Project = {
  id: string;
  slug: string;
  name: string;
  niche: string | null;
  kind: "yt_channel" | "artist" | "both";
  status: "aktywny" | "utrzymanie" | "planowany" | "zamknięty";
  yt_channel_id: string | null;
  distrokid_artist: string | null;
};

export type GateRule =
  | { rule: "ctr_last3_weighted"; min_pct: number }
  | { rule: "impressions_wow_rising" }
  | { rule: "watch_hours_month_vs"; month: string; vs: string };

export type Gate = { id: string; project_id: string; title: string; due: string; rules: GateRule[]; note: string | null };

/** One row of v_video_recent: the last 42 days of a video, summed, plus per-week totals */
export type VideoRecent = {
  project_id: string;
  yt_video_id: string;
  views: number | null;
  watch_minutes: number | null;
  subs_net: number | null;
  impressions: number | null;
  clicks: number | null;
  weeks: { week_start: string; views: number; watch_minutes: number; subs_net: number; impressions: number; clicks: number }[];
};

/** integration_status(): everything except the refresh token */
export type Integration = {
  project_id: string;
  provider: "youtube";
  yt_channel_id: string | null;
  reporting_job_id: string | null;
  reports_cursor: string | null;
  last_sync_at: string | null;
  last_error: string | null;
};

export type Settings = { budget_min: number; budget_max: number; usd_pln: number; vat_pct: number };

export type XpEvent = { kind: string; ref: string; title: string; at: string; xp: number };

export type Data = {
  tasks: Task[];
  items: Item[];
  weeks: Week[];
  subs: Sub[];
  projects: Project[];
  gates: Gate[];
  videos: VideoRecent[];
  integrations: Integration[];
  settings: Settings;
  xp: XpEvent[];
};

export type Coll = "tasks" | "items" | "weeks" | "subs";
