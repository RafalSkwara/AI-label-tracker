import { requireAnyRole } from "@/lib/server/auth";
import { serviceDb } from "@/lib/server/db";
import { sendToUsers } from "@/lib/server/push";

/** Sends a test notification to every device of the caller */
export async function POST(req: Request) {
  const me = await requireAnyRole(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const r = await sendToUsers(serviceDb(), [me.userId], { title: "Powiadomienia działają", body: "Tak będą wyglądać przypomnienia z kalendarza i o płatnościach za subskrypcje.", url: "/", tag: "test" });
    return Response.json(r);
  } catch (e) {
    console.error("push test:", (e as Error).message);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
