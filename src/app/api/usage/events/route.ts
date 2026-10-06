import { NextResponse } from "next/server";
import { UsageBatchSchema } from "@/lib/analytics/catalog";
import { recordUsage } from "@/lib/analytics/server";

const MAX_BODY_BYTES = 16_384;
const respond = (status: number, ok = false) => NextResponse.json({ ok }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  // JSON fetches from browsers include Origin; reject absent/foreign origins too.
  if (request.headers.get("origin") !== new URL(request.url).origin) return respond(403);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") return respond(415);
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return respond(413);
  const reader = request.body?.getReader();
  if (!reader) return respond(400);
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel(); return respond(413); }
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const parsed = UsageBatchSchema.safeParse(body);
    if (!parsed.success) return respond(400);
    const result = await recordUsage(parsed.data.visitorId, parsed.data.events);
    return respond(result.ok ? 200 : 503, result.ok);
  } catch { return respond(400); }
}
