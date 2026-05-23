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

    const { data, error } = await auth.supabaseAdmin
      .from("drivers")
      .select("id,first_name,last_name,phone,email,status,online,busy,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[admin-drivers-list] failed to load drivers", error);
      return NextResponse.json(
        { ok: false, error: "Could not load drivers. Please refresh or contact admin support." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, drivers: data ?? [] });
  } catch (error: unknown) {
    console.error("[admin-drivers-list] unexpected error", errorMessage(error, "Unknown error"));
    return NextResponse.json(
      { ok: false, error: "Could not load drivers. Please refresh or contact admin support." },
      { status: 500 }
    );
  }
}
