import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

async function getUserIdByEmail(supabaseAdmin: any, email: string): Promise<string | null> {
  // @ts-ignore
  if (supabaseAdmin.auth?.admin?.getUserByEmail) {
    // @ts-ignore
    const { data, error } = await supabaseAdmin.auth.admin.getUserByEmail(email);
    if (error) return null;
    return data?.user?.id ?? null;
  }

  // @ts-ignore
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000, page: 1 });
  if (error) return null;

  const user = (data?.users ?? []).find(
    (u: any) => (u.email ?? "").toLowerCase() === email.toLowerCase()
  );
  return user?.id ?? null;
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin } = auth;
    const body = await req.json();

    const email = String(body.email ?? "").trim().toLowerCase();
    const driverIdRaw = body.driverId;
    const action = String(body.action ?? "link");

    if (!email) {
      return NextResponse.json({ ok: false, error: "Missing email" }, { status: 400 });
    }

    const userId = await getUserIdByEmail(supabaseAdmin, email);
    if (!userId) {
      return NextResponse.json({ ok: false, error: "No auth user found for that email" }, { status: 404 });
    }

    if (action === "unlink") {
      const { error } = await supabaseAdmin
        .from("driver_accounts")
        .upsert({ user_id: userId, driver_id: null }, { onConflict: "user_id" });

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, message: "Unlinked successfully", userId });
    }

    const driverId = String(driverIdRaw ?? "").trim();
    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Missing driverId" }, { status: 400 });
    }

    const { data: driver, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("id", driverId)
      .single();

    if (dErr || !driver) {
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
          error: upErr.message + " (That driver may already be linked to another account.)",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, message: "Linked successfully", userId, driverId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}