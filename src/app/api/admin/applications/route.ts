import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin } = auth;
    const url = new URL(req.url);
    const status = url.searchParams.get("status");

    let query = supabaseAdmin
      .from("driver_applications")
      .select("id,user_id,full_name,phone,email,notes,status,created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (status && ["pending", "approved", "rejected"].includes(status)) {
      query = query.eq("status", status);
    }

    const { data: apps, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const applications = apps ?? [];
    const userIds = applications.map((a: any) => a.user_id).filter(Boolean);

    let linkedByUser: Record<string, string | null> = {};
    if (userIds.length > 0) {
      const { data: mappings, error: mErr } = await supabaseAdmin
        .from("driver_accounts")
        .select("user_id,driver_id")
        .in("user_id", userIds);

      if (mErr) {
        return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });
      }

      (mappings ?? []).forEach((m: any) => {
        linkedByUser[m.user_id] = m.driver_id ?? null;
      });
    }

    const enriched = applications.map((a: any) => ({
      ...a,
      linked_driver_id: linkedByUser[a.user_id] ?? null,
    }));

    return NextResponse.json({ ok: true, applications: enriched });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}