import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { uploadDriverDocument } from "@/lib/driver-documents";

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

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
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
      { auth: { persistSession: false } }
    );

    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mappingError) {
      console.error("[driver-doc-upload] account mapping failed", {
        userId: user.id,
        message: mappingError.message,
        code: mappingError.code,
      });
      return NextResponse.json({ ok: false, error: "Could not verify your driver account." }, { status: 500 });
    }

    if (!mapping?.driver_id) {
      return NextResponse.json({ ok: false, error: "Driver account is not linked yet." }, { status: 400 });
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const documentType = form.get("documentType") ?? form.get("docType");
    const required = String(form.get("required") ?? "false") === "true";

    if (!file) {
      return NextResponse.json({ ok: false, error: "Choose a document to upload." }, { status: 400 });
    }

    const result = await uploadDriverDocument({
      supabase: supabaseAdmin,
      driverId: String(mapping.driver_id),
      documentType,
      file,
      uploadedBy: user.id,
      required,
      source: "driver",
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      path: result.path,
      documentType: result.documentType,
      message: "Document uploaded for MOOVU review.",
    });
  } catch (error: unknown) {
    console.error("[driver-doc-upload] unexpected failure", { message: errorMessage(error) });
    return NextResponse.json({ ok: false, error: "We could not upload this document. Please try again." }, { status: 500 });
  }
}
