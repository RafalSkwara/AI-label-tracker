import type { Sub } from "./types";

/** Billing pages of services we use, for subscriptions without their own link. Matched on the start of the name. */
const KNOWN: [RegExp, string][] = [
  [/^suno/i, "https://suno.com/account"],
  [/^midjourney/i, "https://www.midjourney.com/account"],
  [/^elevenlabs/i, "https://elevenlabs.io/app/subscription"],
  [/^distrokid/i, "https://distrokid.com/account/"],
  [/^kling/i, "https://app.klingai.com/global/membership/membership-plan"],
  [/^(claude|anthropic)/i, "https://claude.ai/settings/billing"],
  [/^(chatgpt|openai)/i, "https://chatgpt.com/#settings/Account"],
  [/^canva/i, "https://www.canva.com/settings/billing-and-teams"],
  [/^cloudflare/i, "https://dash.cloudflare.com/?to=/:account/billing"],
  [/^github/i, "https://github.com/settings/billing"],
  [/^google one|^youtube premium/i, "https://myaccount.google.com/payments-and-subscriptions"],
  [/^spotify/i, "https://www.spotify.com/account/subscription/"],
  [/^netflix/i, "https://www.netflix.com/account"],
];

/** Where to edit or cancel the subscription: the saved link, else a known billing page. */
export function manageUrl(s: Pick<Sub, "name" | "dashboard_url">): string | null {
  if (s.dashboard_url && /^https?:\/\//.test(s.dashboard_url)) return s.dashboard_url;
  return KNOWN.find(([re]) => re.test(s.name.trim()))?.[1] ?? null;
}
