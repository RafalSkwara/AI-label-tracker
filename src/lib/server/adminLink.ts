import { serviceDb } from "./db";

export type LinkType = "invite" | "magiclink";

/** One-time sign-in link for /haslo. Built from the hashed token (not action_link, which uses the implicit flow and clashes with PKCE). */
export async function makeLink(origin: string, email: string, type: LinkType) {
  const { data, error } = await serviceDb().auth.admin.generateLink({ type, email });
  if (error || !data.properties?.hashed_token) return { error: error?.message ?? "no token" } as const;
  return { user: data.user, link: `${origin}/haslo?token_hash=${data.properties.hashed_token}&type=${type}` } as const;
}
