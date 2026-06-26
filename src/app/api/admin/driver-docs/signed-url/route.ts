import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import {
  createDriverDocumentSignedUrl,
  normalizeDriverDocumentStoragePath,
} from "@/lib/driver-document-storage";

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
    const normalizedPath = normalizeDriverDocumentStoragePath(path);

    if (!path || !normalizedPath) {
      return NextResponse.json({ ok: false, error: "Missing path" }, { status: 400 });
    }

    const signed = await createDriverDocumentSignedUrl(supabaseAdmin, normalizedPath);
    if (!signed.ok) {
      return NextResponse.json({ ok: false, error: signed.error }, { status: 500 });
    }

    return NextResponse.json({ ok: true, url: signed.url });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(e, "Server error") }, { status: 500 });
  }
}
