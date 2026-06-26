import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  createDriverDocumentSignedUrl,
  driverDocumentPathsMatch,
  normalizeDriverDocumentStoragePath,
} from "@/lib/driver-document-storage";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error.";
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing access token." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const path = String(body?.path ?? "").trim();
    const normalizedPath = normalizeDriverDocumentStoragePath(path);

    if (!path || !normalizedPath) {
      return NextResponse.json({ ok: false, error: "Missing document path." }, { status: 400 });
    }

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mappingError) {
      return NextResponse.json({ ok: false, error: mappingError.message }, { status: 500 });
    }

    if (!mapping?.driver_id) {
      return NextResponse.json({ ok: false, error: "Driver account is not linked yet." }, { status: 400 });
    }

    const { data: documents, error: documentError } = await supabaseAdmin
      .from("driver_documents")
      .select("id,file_path")
      .eq("driver_id", mapping.driver_id)
      .limit(200);

    if (documentError) {
      return NextResponse.json({ ok: false, error: documentError.message }, { status: 500 });
    }

    const document = (documents ?? []).find((row) => driverDocumentPathsMatch(row.file_path, normalizedPath));
    if (!document?.id) {
      return NextResponse.json({ ok: false, error: "Document not found for this driver." }, { status: 404 });
    }

    const signed = await createDriverDocumentSignedUrl(supabaseAdmin, normalizedPath);
    if (!signed.ok) {
      return NextResponse.json({ ok: false, error: signed.error }, { status: 500 });
    }

    return NextResponse.json({ ok: true, url: signed.url });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}
