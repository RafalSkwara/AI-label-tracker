import { secret } from "@/lib/server/env";

/** VAPID public key for PushManager.subscribe (public by design); 503 until the secrets are set */
export async function GET() {
  try {
    return Response.json({ key: secret("VAPID_PUBLIC_KEY") });
  } catch {
    return Response.json({ error: "not configured" }, { status: 503 });
  }
}
