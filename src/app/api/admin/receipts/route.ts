import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { data, error } = await auth.supabaseAdmin
      .from("trips")
      .select(
        "id,rider_name,pickup_address,dropoff_address,fare_amount,payment_method,status,created_at,completed_at,cancelled_at"
      )
      .in("status", ["completed", "cancelled"])
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("[admin-receipts] failed to load receipts", error);
      return NextResponse.json(
        { ok: false, error: "Could not load receipts. Please refresh or contact admin support." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, receipts: data ?? [] });
  } catch (error: unknown) {
    console.error("[admin-receipts] unexpected error", errorMessage(error, "Unknown error"));
    return NextResponse.json(
      { ok: false, error: "Could not load receipts. Please refresh or contact admin support." },
      { status: 500 }
    );
  }
}
