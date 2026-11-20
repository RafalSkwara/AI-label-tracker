import { verifyLink } from "@/lib/server/auth";
import { media } from "@/lib/server/media";

/** GET ?t=<signed key> → the file from R2 as a download (links come from POST /api/video/<id> {action: "link"}, 30 min) */
export async function GET(req: Request) {
  const key = await verifyLink(new URL(req.url).searchParams.get("t") ?? "");
  if (!key || !key.startsWith("jobs/")) return new Response("Link wygasł", { status: 403 });
  const obj = await media()?.get(key);
  if (!obj) return new Response("Plik usunięty", { status: 404 });
  const name = key.split("/").pop()!;
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "video/mp4",
      "content-length": String(obj.size),
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "private, no-store",
    },
  });
}
