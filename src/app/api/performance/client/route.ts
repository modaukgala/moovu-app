import { parsePerformancePayload } from "@/lib/performance/metrics";

let windowStart = 0;
let windowCount = 0;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 1024) return new Response(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > 1024) return new Response(null, { status: 413 });
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  const sample = parsePerformancePayload(parsed);
  if (!sample) return new Response(null, { status: 400 });
  const now = Date.now();
  if (now - windowStart >= 60_000) { windowStart = now; windowCount = 0; }
  if (++windowCount > 100) return new Response(null, { status: 429 });
  console.info("[client-performance]", sample);
  return new Response(null, { status: 204 });
}
