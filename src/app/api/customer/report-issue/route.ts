import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { rebuildDriverQualityMetrics } from "@/lib/quality/rebuildDriverQualityMetrics";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthenticatedCustomer(req);

    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await req.json();

    const tripId = String(body?.tripId ?? "").trim();
    const issueType = String(body?.issueType ?? "").trim();
    const description = String(body?.description ?? "").trim();

    if (!tripId || !issueType || !description) {
      return NextResponse.json(
        { ok: false, error: "Trip, issue type and description are required." },
        { status: 400 }
      );
    }

    const { data: trip, error: tripError } = await auth.supabaseAdmin
      .from("trips")
      .select("id,customer_id,driver_id")
      .eq("id", tripId)
      .eq("customer_id", auth.customer.id)
      .maybeSingle();

    if (tripError) {
      return NextResponse.json({ ok: false, error: tripError.message }, { status: 500 });
    }

    if (!trip) {
      return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
    }

    const { error: issueError } = await auth.supabaseAdmin
      .from("trip_issues")
      .insert({
        trip_id: tripId,
        customer_id: auth.customer.id,
        driver_id: trip.driver_id,
        issue_type: issueType,
        description,
        status: "open",
      });

    if (issueError) {
      return NextResponse.json({ ok: false, error: issueError.message }, { status: 500 });
    }

    await auth.supabaseAdmin
      .from("trips")
      .update({
        issue_reported: true,
        issue_report_note: description,
      })
      .eq("id", tripId);

    if (trip.driver_id) {
      await rebuildDriverQualityMetrics(trip.driver_id).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      message: "Your issue has been submitted to MOOVU support.",
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Server error.") },
      { status: 500 }
    );
  }
}
