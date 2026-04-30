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

    const { supabaseAdmin } = auth;

    const { data, error } = await supabaseAdmin
      .from("drivers")
      .select(`
        id,
        first_name,
        last_name,
        phone,
        status,
        online,
        busy,
        lat,
        lng,
        last_seen,
        verification_status,
        subscription_status,
        subscription_expires_at
      `)
      .order("first_name", { ascending: true });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      drivers: data ?? [],
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Failed to load drivers.") },
      { status: 500 }
    );
  }
}
