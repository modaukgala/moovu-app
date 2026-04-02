import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { supabaseAdmin } = auth;
    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "pending").trim();

    let query = supabaseAdmin
      .from("drivers")
      .select(`
        id,
        first_name,
        last_name,
        phone,
        email,
        status,
        profile_completed,
        verification_status,
        vehicle_make,
        vehicle_model,
        vehicle_year,
        vehicle_color,
        vehicle_registration,
        created_at
      `)
      .order("created_at", { ascending: false });

    if (status && status !== "all") {
      query = query.eq("verification_status", status);
    }

    const { data: applications, error } = await query;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      applications: applications ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}