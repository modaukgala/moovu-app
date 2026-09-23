import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { notifyAdmins, notifyCustomerForTrip } from "@/lib/push-notify";
import { callHardenedRpc } from "@/lib/server/hardenedRpc";
import { isOutboxDeliveryEnabled } from "@/lib/notifications/outboxDelivery";
import { phase4AuthorityForTrip } from "@/lib/finance/phase4AuthorityServer";
import { callPhase4Rpc } from "@/lib/server/phase4Rpc";

type NoShowResult = {
  trip_id: string;
  fee_amount: number;
  driver_amount: number;
  moovu_amount: number;
  replayed: boolean;
  fee_cents?: number;
  driver_cents?: number;
  moovu_cents?: number;
};

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ ok: false, error: "Missing access token." }, { status: 401 });
    const body = await req.json().catch(() => null);
    const tripId = String(body?.tripId ?? "").trim();
    if (!tripId) return NextResponse.json({ ok: false, error: "Trip ID is required." }, { status: 400 });

    const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const { data: mapping, error: mappingError } = await admin.from("driver_accounts").select("driver_id")
      .eq("user_id", user.id).maybeSingle();
    if (mappingError || !mapping?.driver_id) {
      return NextResponse.json({ ok: false, error: "Driver account not linked." }, { status: 403 });
    }

    const authority = await phase4AuthorityForTrip(admin, tripId);
    if (!authority) return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
    const phase4Args = {
      p_trip_id: tripId, p_driver_id: mapping.driver_id, p_actor_id: user.id,
    };
    const result = authority === "PHASE4" ? await callPhase4Rpc<NoShowResult>(admin, "phase4b_mark_customer_no_show", phase4Args,
      (value) => typeof value.replayed === "boolean")
      : await callHardenedRpc<NoShowResult>(admin, "phase05b_mark_no_show", phase4Args);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
    }
    const outcome = result.result;
    const feeAmount = authority === "PHASE4" ? Number(outcome.fee_cents ?? 0) / 100 : outcome.fee_amount;
    const driverAmount = authority === "PHASE4" ? Number(outcome.driver_cents ?? 0) / 100 : outcome.driver_amount;
    const moovuAmount = authority === "PHASE4" ? Number(outcome.moovu_cents ?? 0) / 100 : outcome.moovu_amount;
    if (!outcome.replayed && !isOutboxDeliveryEnabled()) {
      await Promise.all([
        notifyCustomerForTrip(
          tripId, "Trip marked no-show", `Your trip was marked no-show. A R${feeAmount.toFixed(2)} fee was assessed.`, `/ride/${tripId}`,
        ).catch(() => null),
        notifyAdmins("Customer no-show", `Trip ${tripId} was marked as customer no-show.`, "/admin/trips").catch(() => null),
      ]);
    }
    return NextResponse.json({
      ok: true,
      replayed: outcome.replayed,
      message: outcome.replayed ? "This no-show was already recorded."
        : authority === "PHASE4" ? `No-show recorded. R${driverAmount.toFixed(2)} Driver compensation earned.`
          : `No-show recorded. Driver commission offset: R${driverAmount}.`,
      fee: { feeAmount, driverAmount, moovuAmount },
    });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error." }, { status: 500 });
  }
}
