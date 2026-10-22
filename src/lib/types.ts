export type Task = {
  id: string;
  title: string;
  phase: "F0" | "F1" | "F2" | "F3";
  due: string | null;
  note: string | null;
  done: boolean;
  done_at: string | null;
};

export type Item = {
  id: string;
  channel_id: string | null;
  title: string;
  kind: "film" | "EP" | "short";
  status: "pomysł" | "produkcja" | "zaplanowany" | "live";
  publish_date: string | null;
  url: string | null;
  note: string | null;
  live_at: string | null;
  updated_at: string;
};

export type Week = {
  channel_id: string;
  week_start: string;
  uploads: number | null;
  views: number | null;
  watch_hours: number | null;
  subs_net: number | null;
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
  note: string | null;
};

export type Channel = { id: string; name: string; niche: string | null };

export type Settings = { budget_min: number; budget_max: number; usd_pln: number; vat_pct: number };

export type XpEvent = { kind: string; ref: string; title: string; at: string; xp: number };

export type Data = {
  tasks: Task[];
  items: Item[];
  weeks: Week[];
  subs: Sub[];
  channels: Channel[];
  settings: Settings;
  xp: XpEvent[];
};

export type Coll = "tasks" | "items" | "weeks" | "subs";
