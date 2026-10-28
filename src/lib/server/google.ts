import { secret } from "./env";

const SCOPES = ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly"];
export const REACH_REPORT = "channel_reach_basic_a1";

export class GoogleError extends Error {
  constructor(message: string, readonly status: number, readonly code?: "no-channel" | "no-refresh-token") {
    super(message);
  }
}

/** fetch with a timeout (20 s; report downloads 60 s), so one hung request cannot stall a whole sync */
const tfetch = (url: string, init: RequestInit = {}, ms = 20_000) => fetch(url, { ...init, signal: AbortSignal.timeout(ms) });

async function json<T>(r: Response, what: string): Promise<T> {
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      msg = j.error === "invalid_grant" ? "invalid_grant" : (j.error_description ?? j.error?.message ?? (typeof j.error === "string" ? j.error : msg));
    } catch {}
    throw new GoogleError(`${what}: ${msg}`, r.status);
  }
  return JSON.parse(text) as T;
}

export const redirectUri = (origin: string) => `${origin}/api/yt/callback`;

export function authUrl(origin: string, state: string): string {
  const p = new URLSearchParams({
    client_id: secret("GOOGLE_CLIENT_ID"), redirect_uri: redirectUri(origin), response_type: "code",
    scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

const token = (body: Record<string, string>) =>
  tfetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: secret("GOOGLE_CLIENT_ID"), client_secret: secret("GOOGLE_CLIENT_SECRET"), ...body }),
  });

export async function exchangeCode(origin: string, code: string) {
  const j = await json<{ access_token: string; refresh_token?: string }>(
    await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri(origin) }), "token exchange");
  if (!j.refresh_token) throw new GoogleError("Google returned no refresh token", 400, "no-refresh-token");
  return { accessToken: j.access_token, refreshToken: j.refresh_token };
}

export async function refreshAccess(refreshToken: string): Promise<string> {
  const j = await json<{ access_token: string }>(await token({ grant_type: "refresh_token", refresh_token: refreshToken }), "token refresh");
  return j.access_token;
}

const get = async <T>(url: string, at: string, what: string) => json<T>(await tfetch(url, { headers: { authorization: `Bearer ${at}` } }), what);
const qs = (o: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();

export async function myChannel(at: string): Promise<{ id: string; uploads: string }> {
  const j = await get<{ items?: { id: string; contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }>(
    "https://www.googleapis.com/youtube/v3/channels?" + qs({ part: "id,contentDetails", mine: "true" }), at, "channels.list");
  const c = j.items?.[0];
  if (!c?.contentDetails?.relatedPlaylists?.uploads) throw new GoogleError("No YouTube channel on this account", 404, "no-channel");
  return { id: c.id, uploads: c.contentDetails.relatedPlaylists.uploads };
}

export type Upload = { id: string; publishedAt: string };

/** The uploads playlist id is the channel id with the UC prefix replaced by UU; null when the id has another shape */
export const uploadsPlaylistOf = (channelId: string) => (channelId.startsWith("UC") ? "UU" + channelId.slice(2) : null);

/** Uploads playlist entries, newest first (up to 3 pages of 50) */
export async function uploads(at: string, playlist: string): Promise<Upload[]> {
  const out: Upload[] = [];
  let page: string | undefined;
  for (let i = 0; i < 3; i++) {
    const j = await get<{ items?: { contentDetails: { videoId: string; videoPublishedAt?: string } }[]; nextPageToken?: string }>(
      "https://www.googleapis.com/youtube/v3/playlistItems?" + qs({ part: "contentDetails", playlistId: playlist, maxResults: 50, pageToken: page }), at, "playlistItems.list");
    out.push(...(j.items ?? []).map((x) => ({ id: x.contentDetails.videoId, publishedAt: x.contentDetails.videoPublishedAt ?? "" })));
    page = j.nextPageToken;
    if (!page) break;
  }
  return out;
}

export function analytics(at: string, ids: string[], start: string, end: string) {
  return get<{ columnHeaders?: { name: string }[]; rows?: (string | number)[][] | null }>(
    "https://youtubeanalytics.googleapis.com/v2/reports?" + qs({
      ids: "channel==MINE", startDate: start, endDate: end, dimensions: "day,video", filters: "video==" + ids.join(","),
      metrics: "views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost", sort: "day",
    }), at, "analytics.query");
}

const REPORTING = "https://youtubereporting.googleapis.com/v1";

/** Existing reach job, or a new one. Returns its id. */
export async function ensureReachJob(at: string): Promise<string> {
  const list = await get<{ jobs?: { id: string; reportTypeId: string }[] }>(`${REPORTING}/jobs?` + qs({ pageSize: 100 }), at, "jobs.list");
  const found = list.jobs?.find((j) => j.reportTypeId === REACH_REPORT);
  if (found) return found.id;
  const r = await tfetch(`${REPORTING}/jobs`, {
    method: "POST", headers: { authorization: `Bearer ${at}`, "content-type": "application/json" },
    body: JSON.stringify({ reportTypeId: REACH_REPORT, name: "side-hustle-reach" }),
  });
  return (await json<{ id: string }>(r, "jobs.create")).id;
}

export type ReportMeta = { id: string; createTime: string; downloadUrl: string };

/** Reports created after `after` in ascending createTime order, so the newest correction is written last */
export async function listReports(at: string, jobId: string, after: string | null): Promise<ReportMeta[]> {
  const all: ReportMeta[] = [];
  let page: string | undefined;
  do {
    const j = await get<{ reports?: ReportMeta[]; nextPageToken?: string }>(
      `${REPORTING}/jobs/${jobId}/reports?` + qs({ createdAfter: after ?? undefined, pageSize: 100, pageToken: page }), at, "reports.list");
    all.push(...(j.reports ?? []));
    page = j.nextPageToken;
  } while (page);
  return all.sort((a, b) => a.createTime.localeCompare(b.createTime));
}

export async function downloadReport(at: string, url: string): Promise<string> {
  const r = await tfetch(url, { headers: { authorization: `Bearer ${at}` } }, 60_000);
  if (!r.ok) throw new GoogleError(`report download: ${r.status}`, r.status);
  return r.text();
}

const ANALYTICS = "https://youtubeanalytics.googleapis.com/v2/reports?";
type AnalyticsJson = { columnHeaders?: { name: string }[]; rows?: (string | number)[][] | null };

/**
 * Traffic sources of ONE video. Kept behind this helper: `video==a,b` would sum the videos into one row
 * (video is not a dimension of this report), so per-video shares need one call per video.
 */
export function trafficSources(at: string, videoId: string, start: string, end: string) {
  return get<AnalyticsJson>(ANALYTICS + qs({
    ids: "channel==MINE", startDate: start, endDate: end, dimensions: "insightTrafficSourceType",
    filters: "video==" + videoId, metrics: "views,estimatedMinutesWatched", sort: "-views",
  }), at, "analytics.traffic");
}

/** Top YouTube search terms of one video */
export function searchTerms(at: string, videoId: string, start: string, end: string) {
  return get<AnalyticsJson>(ANALYTICS + qs({
    ids: "channel==MINE", startDate: start, endDate: end, dimensions: "insightTrafficSourceDetail",
    filters: `video==${videoId};insightTrafficSourceType==YT_SEARCH`, metrics: "views", sort: "-views", maxResults: 25,
  }), at, "analytics.searchTerms");
}

/** Public counters (1 quota unit per call), up to 50 ids */
export function videoStatistics(at: string, ids: string[]) {
  return get<{ items?: { id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[] }>(
    "https://www.googleapis.com/youtube/v3/videos?" + qs({ part: "statistics", id: ids.join(","), maxResults: 50 }), at, "videos.list");
}
