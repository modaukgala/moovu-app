import { NextResponse } from "next/server";
import { phase2Mode } from "@/lib/finance/phase2Policy";
import {
  processPhase2ShadowRecoveryJob,
  type Phase2ShadowRecoveryJob,
} from "@/lib/finance/phase2ShadowRecovery";
import { supabaseAdmin } from "@/lib/supabase/admin";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized recovery worker." }, { status: 401 });
  }
  if (phase2Mode() === "OFF") {
    return NextResponse.json({ ok: true, processed: 0, skipped: "Phase 2 is OFF." });
  }
  const { data, error } = await supabaseAdmin.rpc("phase2_claim_shadow_recovery_jobs", { p_limit: 20 });
  if (error) {
    console.error("[phase2-recovery] claim failed", { code: error.code });
    return NextResponse.json({ ok: false, error: "Phase 2 recovery contract is unavailable." }, { status: 503 });
  }
  const results = [];
  for (const job of (data ?? []) as Phase2ShadowRecoveryJob[]) {
    results.push({ jobId: job.id, ...(await processPhase2ShadowRecoveryJob(supabaseAdmin, job)) });
  }
  return NextResponse.json({ ok: true, processed: results.length, results });
}
