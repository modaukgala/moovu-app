import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const action = String(body.action ?? "").trim(); // approve | reject | link | unlink
    const applicationId = String(body.applicationId ?? "").trim();
    const userId = String(body.userId ?? "").trim(); // auth user id
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

    // 1) Approve / Reject just updates application status
    if (action === "approve" || action === "reject") {
      const newStatus = action === "approve" ? "approved" : "rejected";

      const { error } = await supabaseAdmin
        .from("driver_applications")
        .update({ status: newStatus })
        .eq("id", applicationId);

      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

      return NextResponse.json({ ok: true, message: `Application marked ${newStatus}` });
    }

    // 2) Link / Unlink updates driver_accounts mapping
    if (action === "unlink") {
      const { error } = await supabaseAdmin
        .from("driver_accounts")
        .upsert({ user_id: userId, driver_id: null }, { onConflict: "user_id" });

      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

      return NextResponse.json({ ok: true, message: "Unlinked successfully" });
    }

    // action === "link"
    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Missing driverId" }, { status: 400 });
    }

    // Ensure driver exists
    const { data: d, error: dErr } = await supabaseAdmin.from("drivers").select("id").eq("id", driverId).single();
    if (dErr || !d) {
      return NextResponse.json({ ok: false, error: "Driver UUID not found in drivers table" }, { status: 404 });
    }

    const { error: upErr } = await supabaseAdmin
      .from("driver_accounts")
      .upsert({ user_id: userId, driver_id: driverId }, { onConflict: "user_id" });

    if (upErr) {
      return NextResponse.json(
        { ok: false, error: upErr.message + " (Driver UUID may already be linked to another account.)" },
        { status: 500 }
      );
    }

    // Optional: auto-approve when linking
    await supabaseAdmin
      .from("driver_applications")
      .update({ status: "approved" })
      .eq("id", applicationId);

    return NextResponse.json({ ok: true, message: "Linked successfully (and application approved)" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}