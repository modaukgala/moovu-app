import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

function splitName(full: string | null): { first: string | null; last: string | null } {
  const n = (full ?? "").trim();
  if (!n) return { first: null, last: null };
  const parts = n.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin } = auth;
    const { applicationId } = await req.json();

    if (!applicationId) {
      return NextResponse.json({ ok: false, error: "Missing applicationId" }, { status: 400 });
    }

    const { data: app, error: aErr } = await supabaseAdmin
      .from("driver_applications")
      .select("id,user_id,full_name,phone,email,status")
      .eq("id", applicationId)
      .single();

    if (aErr || !app) {
      return NextResponse.json(
        { ok: false, error: aErr?.message ?? "Application not found" },
        { status: 404 }
      );
    }

    const { data: existingMap } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", app.user_id)
      .single();

    if (existingMap?.driver_id) {
      return NextResponse.json({
        ok: true,
        message: "Already linked",
        driverId: existingMap.driver_id,
      });
    }

    const { first, last } = splitName(app.full_name);

    const { data: createdDriver, error: dErr } = await supabaseAdmin
      .from("drivers")
      .insert({
        first_name: first,
        last_name: last,
        phone: app.phone ?? null,
        email: app.email ?? null,
        status: "approved",
        online: false,
        busy: false,
      })
      .select("id")
      .single();

    if (dErr || !createdDriver) {
      return NextResponse.json(
        { ok: false, error: dErr?.message ?? "Failed to create driver" },
        { status: 500 }
      );
    }

    const driverId = createdDriver.id;

    const { error: linkErr } = await supabaseAdmin
      .from("driver_accounts")
      .upsert({ user_id: app.user_id, driver_id: driverId }, { onConflict: "user_id" });

    if (linkErr) {
      return NextResponse.json(
        { ok: false, error: linkErr.message + " (Driver may already be linked elsewhere.)" },
        { status: 500 }
      );
    }

    await supabaseAdmin
      .from("driver_applications")
      .update({ status: "approved" })
      .eq("id", applicationId);

    return NextResponse.json({
      ok: true,
      message: "Driver created + linked + approved",
      driverId,
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(e, "Server error") }, { status: 500 });
  }
}
