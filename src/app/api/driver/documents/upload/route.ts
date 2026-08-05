import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  finalizeDriverDocumentUpload,
  prepareDriverDocumentUpload,
  uploadDriverDocument,
  type DriverDocumentFileDescriptor,
} from "@/lib/driver-documents";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error.";
}

function resultStatus(error: string) {
  if (/too large/i.test(error)) return 413;
  if (/unsupported file type/i.test(error)) return 415;
  if (/could not be verified/i.test(error)) return 404;
  if (/choose|invalid|linked yet/i.test(error)) return 400;
  if (/storage/i.test(error)) return 502;
  return 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

    const driverId = String(mapping.driver_id);
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body: unknown = await req.json();
      if (!isRecord(body) || !isRecord(body.file)) {
        return NextResponse.json({ ok: false, error: "Invalid upload request." }, { status: 400 });
      }

      const action = String(body.action ?? "");
      const file = body.file as DriverDocumentFileDescriptor;
      const documentType = body.documentType;
      const required = body.required === true;

      console.info("[driver-doc-upload] authorized request", {
        actorRole: "driver",
        targetDriverId: driverId,
        documentType: String(documentType ?? ""),
        action,
        sessionPresent: true,
        tokenPresent: true,
      });

      if (action === "prepare") {
        const prepared = await prepareDriverDocumentUpload({
          supabase: supabaseAdmin,
          driverId,
          documentType,
          file,
        });
        if (!prepared.ok) {
          return NextResponse.json({ ok: false, error: prepared.error }, { status: resultStatus(prepared.error) });
        }
        return NextResponse.json(prepared);
      }

      if (action === "finalize") {
        const finalized = await finalizeDriverDocumentUpload({
          supabase: supabaseAdmin,
          driverId,
          documentType,
          path: body.path,
          file,
          uploadedBy: user.id,
          required,
          source: "driver",
        });
        if (!finalized.ok) {
          return NextResponse.json({ ok: false, error: finalized.error }, { status: resultStatus(finalized.error) });
        }
        console.info("[driver-doc-upload] upload finalized", {
          actorRole: "driver",
          targetDriverId: driverId,
          documentType: finalized.documentType,
          path: finalized.path,
        });
        return NextResponse.json({ ...finalized, message: "Document uploaded for MOOVU review." });
      }

      return NextResponse.json({ ok: false, error: "Invalid upload action." }, { status: 400 });
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
      driverId,
      documentType,
      file,
      uploadedBy: user.id,
      required,
      source: "driver",
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: resultStatus(result.error) });
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
