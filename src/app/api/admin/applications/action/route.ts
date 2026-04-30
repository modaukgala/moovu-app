import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin, user } = auth;
    const body = await req.json();

    const action = String(body.action ?? "").trim();
    const applicationId = String(body.applicationId ?? "").trim();
    const userId = String(body.userId ?? "").trim();
    const driverId = body.driverId ? String(body.driverId).trim() : null;

    if (!action || !applicationId || !userId) {
      return NextResponse.json(
        { ok: false, error: "Missing action/applicationId/userId" },
        { status: 400 }
      );
    }

    if (!["approve", "reject", "link", "unlink"].includes(action)) {
      return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
    }

    if (action === "approve" || action === "reject") {
      const newStatus = action === "approve" ? "approved" : "rejected";

      const { error } = await supabaseAdmin
        .from("driver_applications")
        .update({ status: newStatus })
        .eq("id", applicationId);

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      try {
        await supabaseAdmin.from("driver_application_events").insert({
          application_id: applicationId,
          action,
          note: `Application marked ${newStatus}`,
          created_by: user.id,
        });
      } catch {}

      return NextResponse.json({ ok: true, message: `Application marked ${newStatus}` });
    }

    if (action === "unlink") {
      const { error } = await supabaseAdmin
        .from("driver_accounts")
        .upsert({ user_id: userId, driver_id: null }, { onConflict: "user_id" });

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, message: "Unlinked successfully" });
    }

    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Missing driverId" }, { status: 400 });
    }

    const { data: d, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("id", driverId)
      .single();

    if (dErr || !d) {
      return NextResponse.json(
        { ok: false, error: "Driver UUID not found in drivers table" },
        { status: 404 }
      );
    }

    const { error: upErr } = await supabaseAdmin
      .from("driver_accounts")
      .upsert({ user_id: userId, driver_id: driverId }, { onConflict: "user_id" });

    if (upErr) {
      return NextResponse.json(
        {
          ok: false,
          error: upErr.message + " (Driver UUID may already be linked to another account.)",
        },
        { status: 500 }
      );
    }

    await supabaseAdmin
      .from("driver_applications")
      .update({ status: "approved" })
      .eq("id", applicationId);

    return NextResponse.json({
      ok: true,
      message: "Linked successfully (and application approved)",
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(e, "Server error") }, { status: 500 });
  }
}
