import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dispatchVerifiedOnlineTrip } from "@/lib/payments/yoco/dispatch";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "Unauthorized payment dispatch worker." }, { status: 401 });
  const { data, error } = await supabaseAdmin.from("online_payment_attempts")
    .select("id").eq("state", "SUCCEEDED").in("dispatch_state", ["PENDING", "FAILED"])
    .lt("dispatch_attempts", 10).order("updated_at", { ascending: true }).limit(20);
  if (error) return NextResponse.json({ ok: false, error: "Payment dispatch recovery is unavailable." }, { status: 503 });
  const results = [];
  for (const attempt of data ?? []) {
    try { results.push({ id: attempt.id, ...(await dispatchVerifiedOnlineTrip(attempt.id)) }); }
    catch (dispatchError) { results.push({ id: attempt.id, ok: false, error: dispatchError instanceof Error ? dispatchError.message : "Dispatch failed." }); }
  }
  return NextResponse.json({ ok: true, processed: results.length, results });
}
