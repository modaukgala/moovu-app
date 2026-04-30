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

    const { supabaseAdmin } = auth;
    const body = await req.json();
    const path = String(body?.path ?? "").trim();

    if (!path) {
      return NextResponse.json({ ok: false, error: "Missing path" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.storage
      .from("driver-docs")
      .createSignedUrl(path, 60 * 5);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, url: data.signedUrl });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(e, "Server error") }, { status: 500 });
  }
}
