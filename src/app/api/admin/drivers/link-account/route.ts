import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function getUserIdByEmail(email: string): Promise<string | null> {
  // Preferred (Supabase JS v2):
  // @ts-ignore
  if (supabaseAdmin.auth?.admin?.getUserByEmail) {
    // @ts-ignore
    const { data, error } = await supabaseAdmin.auth.admin.getUserByEmail(email);
    if (error) return null;
    return data?.user?.id ?? null;
  }

  // Fallback: list users and find match (slower but works)
  // @ts-ignore
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000, page: 1 });
  if (error) return null;

  const user = (data?.users ?? []).find((u: any) => (u.email ?? "").toLowerCase() === email.toLowerCase());
  return user?.id ?? null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const driverIdRaw = body.driverId;

    if (!email) {
      return NextResponse.json({ ok: false, error: "Missing email" }, { status: 400 });
    }

    const action = String(body.action ?? "link");

    const userId = await getUserIdByEmail(email);
    if (!userId) {
      return NextResponse.json({ ok: false, error: "No auth user found for that email" }, { status: 404 });
    }

    if (action === "unlink") {
      const { error } = await supabaseAdmin
        .from("driver_accounts")
        .upsert({ user_id: userId, driver_id: null }, { onConflict: "user_id" });

      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

      return NextResponse.json({ ok: true, message: "Unlinked successfully", userId });
    }

    const driverId = String(driverIdRaw ?? "").trim();
    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Missing driverId" }, { status: 400 });
    }

    // Validate driver exists
    const { data: driver, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("id", driverId)
      .single();

    if (dErr || !driver) {
      return NextResponse.json({ ok: false, error: "Driver UUID not found in drivers table" }, { status: 404 });
    }

    // Link mapping
    const { error: upErr } = await supabaseAdmin
      .from("driver_accounts")
      .upsert({ user_id: userId, driver_id: driverId }, { onConflict: "user_id" });

    if (upErr) {
      return NextResponse.json(
        {
          ok: false,
          error:
            upErr.message +
            " (If it says duplicate key, that driver UUID is already linked to someone else.)",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, message: "Linked successfully", userId, driverId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}