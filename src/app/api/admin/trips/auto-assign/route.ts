import { NextResponse } from "next/server";
import { offerNextEligibleDriver } from "@/lib/trip-offers";

export async function POST(req: Request) {
  try {
    const { tripId, excludeDriverIds } = await req.json();

    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Missing tripId" }, { status: 400 });
    }

    const result = await offerNextEligibleDriver(
      tripId,
      Array.isArray(excludeDriverIds) ? excludeDriverIds : []
    );

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, exhausted: (result as any).exhausted ?? false },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}