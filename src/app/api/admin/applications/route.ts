import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

type DriverApplicationRow = {
  id: string;
  user_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: string | null;
  created_at: string | null;
};

type DriverAccountRow = {
  user_id: string;
  driver_id: string | null;
};

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

    const applications = (apps ?? []) as DriverApplicationRow[];
    const userIds = applications
      .map((application) => application.user_id)
      .filter((userId): userId is string => Boolean(userId));

    const linkedByUser: Record<string, string | null> = {};
    if (userIds.length > 0) {
      const { data: mappings, error: mErr } = await supabaseAdmin
        .from("driver_accounts")
        .select("user_id,driver_id")
        .in("user_id", userIds);

      if (mErr) {
        return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });
      }

      ((mappings ?? []) as DriverAccountRow[]).forEach((mapping) => {
        linkedByUser[mapping.user_id] = mapping.driver_id ?? null;
      });
    }

    const enriched = applications.map((application) => ({
      ...application,
      linked_driver_id: application.user_id ? linkedByUser[application.user_id] ?? null : null,
    }));

    return NextResponse.json({ ok: true, applications: enriched });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(e, "Server error") }, { status: 500 });
  }
}
