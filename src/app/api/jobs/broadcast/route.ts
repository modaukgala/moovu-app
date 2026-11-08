import { NextResponse } from "next/server";
import { processBroadcastRequests, processOfferDeviceJobs } from "@/lib/dispatch/broadcastWorker";
import { isDispatchWorkerAuthorized } from "@/lib/dispatch/dispatchScheduler";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function run(req: Request) {
  if (!isDispatchWorkerAuthorized(req)) return NextResponse.json({ error: "Unauthorized worker." }, { status: 401 });
  try {
    const requests = await processBroadcastRequests();
    const devices = await processOfferDeviceJobs();
    return NextResponse.json({ ok: true, requests, devices }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[broadcast] worker invocation failed");
    return NextResponse.json({ ok: false, error: "Durable work requires retry." }, { status: 503 });
  }
}

export const POST = run;
export const GET = run;
