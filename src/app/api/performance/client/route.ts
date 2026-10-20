import { parsePerformancePayload } from "@/lib/performance/metrics";

let windowStart = 0;
let windowCount = 0;

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 1024) return new Response(null, { status: 413 });
  const now = Date.now();
  if (now - windowStart >= 60_000) { windowStart = now; windowCount = 0; }
  if (++windowCount > 100) return new Response(null, { status: 429 });
  if (!request.body) return new Response(null, { status: 400 });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 1024) {
      await reader.cancel();
      return new Response(null, { status: 413 });
    }
    chunks.push(value);
  }
  const raw = new TextDecoder().decode(Buffer.concat(chunks));
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  const sample = parsePerformancePayload(parsed);
  if (!sample) return new Response(null, { status: 400 });
  console.info("[client-performance]", sample);
  return new Response(null, { status: 204 });
}
