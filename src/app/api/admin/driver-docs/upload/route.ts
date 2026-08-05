import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import {
  finalizeDriverDocumentUpload,
  prepareDriverDocumentUpload,
  uploadDriverDocument,
  type DriverDocumentFileDescriptor,
} from "@/lib/driver-documents";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function resultStatus(error: string) {
  if (/too large/i.test(error)) return 413;
  if (/unsupported file type/i.test(error)) return 415;
  if (/could not be verified/i.test(error)) return 404;
  if (/choose|invalid|missing|linked yet/i.test(error)) return 400;
  if (/storage/i.test(error)) return 502;
  return 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin } = auth;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body: unknown = await req.json();
      if (!isRecord(body) || !isRecord(body.file)) {
        return NextResponse.json({ ok: false, error: "Invalid upload request." }, { status: 400 });
      }

      const action = String(body.action ?? "");
      const driverId = String(body.driverId ?? "");
      const documentType = body.documentType;
      const file = body.file as DriverDocumentFileDescriptor;
      const required = body.required === true;
      const expiresOn = String(body.expiresOn ?? "") || null;

      if (!driverId || !documentType) {
        return NextResponse.json({ ok: false, error: "Selected driver and document type are required." }, { status: 400 });
      }

      console.info("[admin-driver-doc-upload] authorized request", {
        actorRole: String(auth.profile.role),
        targetDriverId: driverId,
        documentType: String(documentType),
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
          uploadedBy: auth.user.id,
          required,
          source: "admin",
          expiresOn,
        });
        if (!finalized.ok) {
          return NextResponse.json({ ok: false, error: finalized.error }, { status: resultStatus(finalized.error) });
        }
        console.info("[admin-driver-doc-upload] upload finalized", {
          actorRole: String(auth.profile.role),
          targetDriverId: driverId,
          documentType: finalized.documentType,
          path: finalized.path,
        });
        return NextResponse.json(finalized);
      }

      return NextResponse.json({ ok: false, error: "Invalid upload action." }, { status: 400 });
    }

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
      return NextResponse.json({ ok: false, error: result.error }, { status: resultStatus(result.error) });
    }

    return NextResponse.json({ ok: true, path: result.path, documentType: result.documentType });
  } catch (e: unknown) {
    console.error("[admin-driver-doc-upload] unexpected failure", { message: errorMessage(e, "Server error") });
    return NextResponse.json({ ok: false, error: "We could not save this document. Please try again." }, { status: 500 });
  }
}
