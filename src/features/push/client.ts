import { supabase } from "@/lib/supabase";

export type PushState = "unsupported" | "ios-install" | "denied" | "off" | "on";

const auth = async () => ({ authorization: `Bearer ${(await supabase().auth.getSession()).data.session?.access_token ?? ""}`, "content-type": "application/json" });
const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches;

/** base64url (VAPID public key) -> bytes for applicationServerKey */
function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return isIos() && !standalone() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ? "on" : "off";
}

export async function enablePush(): Promise<void> {
  const keyRes = await fetch("/api/push/key");
  if (!keyRes.ok) throw new Error("powiadomienia nie są jeszcze skonfigurowane na serwerze");
  const { key } = (await keyRes.json()) as { key: string };
  if ((await Notification.requestPermission()) !== "granted") throw new Error("brak zgody na powiadomienia");
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  const res = await fetch("/api/push/subscribe", { method: "POST", headers: await auth(), body: JSON.stringify(sub.toJSON()) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function disablePush(): Promise<void> {
  const sub = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
  if (!sub) return;
  await fetch("/api/push/subscribe", { method: "DELETE", headers: await auth(), body: JSON.stringify({ endpoint: sub.endpoint }) });
  await sub.unsubscribe();
}

export async function testPush(): Promise<{ sent: number; failed: number }> {
  const res = await fetch("/api/push/test", { method: "POST", headers: await auth() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
