import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { uploadDriverDocument } from "@/lib/driver-documents";

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
    const form = await req.formData();

    const driverId = String(form.get("driverId") ?? "");
    const docType = form.get("documentType") ?? form.get("docType");
    const expiresOn = String(form.get("expiresOn") ?? "");
    const file = form.get("file") as File | null;

    if (!driverId || !docType || !file) {
      return NextResponse.json({ ok: false, error: "Missing fields." }, { status: 400 });
    }

    const result = await uploadDriverDocument({
      supabase: supabaseAdmin,
      driverId,
      documentType: docType,
      file,
      uploadedBy: auth.user.id,
      required: false,
      source: "admin",
      expiresOn: expiresOn || null,
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }

    return NextResponse.json({ ok: true, path: result.path, documentType: result.documentType });
  } catch (e: unknown) {
    console.error("[admin-driver-doc-upload] unexpected failure", { message: errorMessage(e, "Server error") });
    return NextResponse.json({ ok: false, error: "We could not save this document. Please try again." }, { status: 500 });
  }
}
