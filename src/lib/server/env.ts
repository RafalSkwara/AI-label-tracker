import { getCloudflareContext } from "@opennextjs/cloudflare";

/** Worker secret by name. Values are never logged or returned to the client. */
export function secret(name: string): string {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  const v = (getCloudflareContext().env as unknown as Record<string, string | undefined>)[name];
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
}
