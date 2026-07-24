import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { completeTripServer } from "@/lib/trips/completeTripServer";

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = (await req.json().catch(() => ({}))) as {
      tripId?: unknown;
      note?: unknown;
    };
    const tripId = String(body.tripId ?? "").trim();
    const note = String(body.note ?? "").trim();
    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Trip ID is required." }, { status: 400 });
    }

    const result = await completeTripServer({
      tripId,
      actorId: auth.user.id,
      mode: "admin",
      note,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("[admin-complete] failed", error);
    return NextResponse.json(
      { ok: false, error: "We could not complete this trip. Please try again." },
      { status: 500 },
    );
  }
}
