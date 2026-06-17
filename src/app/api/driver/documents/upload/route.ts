import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error.";
}

function safeSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

function isMissingColumnError(error: { message?: string; code?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42703" || message.includes("column") || message.includes("schema cache");
}

function uploadMetadataRows(driverId: string, docType: string, path: string) {
  const uploadedAt = new Date().toISOString();

  return [
    {
      driver_id: driverId,
      doc_type: docType,
      document_type: docType,
      file_path: path,
      status: "uploaded",
      review_status: "pending",
      uploaded_at: uploadedAt,
    },
    {
      driver_id: driverId,
      document_type: docType,
      file_path: path,
      status: "uploaded",
      review_status: "pending",
      uploaded_at: uploadedAt,
    },
    {
      driver_id: driverId,
      doc_type: docType,
      document_type: docType,
      file_path: path,
      status: "pending",
      review_status: "pending",
      uploaded_at: uploadedAt,
    },
    {
      driver_id: driverId,
      document_type: docType,
      file_path: path,
      status: "pending",
      review_status: "pending",
      uploaded_at: uploadedAt,
    },
    {
      driver_id: driverId,
      document_type: docType,
      file_path: path,
      status: "pending",
      uploaded_at: uploadedAt,
    },
  ];
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
      process.env.SUPABASE_SERVICE_ROLE_KEY!
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

    const form = await req.formData();
    const file = form.get("file") as File | null;
    const docType = String(form.get("docType") ?? "").trim();

    if (!file || !docType) {
      return NextResponse.json({ ok: false, error: "Choose a document to upload." }, { status: 400 });
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ ok: false, error: "File must be 8MB or smaller." }, { status: 400 });
    }

    if (file.type && !ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ ok: false, error: "Upload a PDF, JPG, PNG, or WEBP file." }, { status: 400 });
    }

    const driverId = mapping.driver_id;
    const extension = file.name.includes(".") ? file.name.split(".").pop() : "bin";
    const path = `drivers/${driverId}/${safeSegment(docType)}/${Date.now()}.${safeSegment(extension || "bin")}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { error: uploadError } = await supabaseAdmin.storage
      .from("driver-docs")
      .upload(path, bytes, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ ok: false, error: uploadError.message }, { status: 500 });
    }

    let lastInsertError: { message?: string; code?: string } | null = null;
    for (const row of uploadMetadataRows(driverId, docType, path)) {
      const { error: insertError } = await supabaseAdmin.from("driver_documents").insert(row);
      if (!insertError) {
        return NextResponse.json({ ok: true, path });
      }

      lastInsertError = insertError;
      const message = String(insertError.message ?? "").toLowerCase();
      const retryable =
        isMissingColumnError(insertError) ||
        insertError.code === "23502" ||
        insertError.code === "23514" ||
        message.includes("not-null") ||
        message.includes("violates not-null") ||
        message.includes("violates check constraint");

      if (!retryable) break;
    }

    await supabaseAdmin.storage.from("driver-docs").remove([path]).catch(() => {});
    console.error("[driver-doc-upload] metadata insert failed", {
      driverId,
      docType,
      message: lastInsertError?.message,
      code: lastInsertError?.code,
    });

    return NextResponse.json(
      { ok: false, error: "MOOVU could not save this document for review. Please try again." },
      { status: 500 }
    );
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}
