import { getCloudflareContext } from "@opennextjs/cloudflare";

/** The R2 bucket shared with Slowfall-pipeline (binding MEDIA in wrangler.jsonc). Video jobs live under jobs/<id>/. */
export type R2Object = { key: string; size: number; body: ReadableStream; httpMetadata?: { contentType?: string } };
export type Bucket = {
  put(key: string, value: ReadableStream | ArrayBuffer | string, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<R2Object | null>;
  delete(keys: string | string[]): Promise<void>;
  list(opts: { prefix: string; cursor?: string }): Promise<{ objects: { key: string; size: number }[]; truncated: boolean; cursor?: string }>;
};

export function media(): Bucket | null {
  return ((getCloudflareContext().env as unknown as { MEDIA?: Bucket }).MEDIA) ?? null;
}

/** Removes every object under a prefix; returns how many */
export async function removePrefix(b: Bucket, prefix: string): Promise<number> {
  let n = 0, cursor: string | undefined;
  do {
    const page = await b.list({ prefix, cursor });
    if (page.objects.length) await b.delete(page.objects.map((o) => o.key));
    n += page.objects.length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return n;
}
