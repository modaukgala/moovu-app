import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromBearer } from "@/app/api/driver/utils";
import { respondToOffer } from "@/lib/dispatch/respondToOffer";

export async function POST(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }

    const { tripId, action } = await req.json();

    if (!tripId || !action) {
      return NextResponse.json({ ok: false, error: "Missing tripId/action" }, { status: 400 });
    }

    if (action !== "accept" && action !== "reject") {
      return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
    }

    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mappingError) {
      return NextResponse.json({ ok: false, error: mappingError.message }, { status: 500 });
    }

    const driverId = mapping?.driver_id ?? null;
    if (!driverId) {
      return NextResponse.json(
        { ok: false, code: "NOT_LINKED", error: "Not linked" },
        { status: 403 }
      );
    }

    const atomicResponse = await respondToOffer({
      tripId: String(tripId),
      driverId,
      action: action === "accept" ? "accept" : "decline",
      source: "driver_app",
    });

    return NextResponse.json(
      atomicResponse.ok
        ? { ok: true, status: atomicResponse.state }
        : { ok: false, error: atomicResponse.error ?? "Offer is no longer available." },
      { status: atomicResponse.status },
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
