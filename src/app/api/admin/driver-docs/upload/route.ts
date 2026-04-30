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
    const form = await req.formData();

    const driverId = String(form.get("driverId") ?? "");
    const docType = String(form.get("docType") ?? "");
    const expiresOn = String(form.get("expiresOn") ?? "");
    const file = form.get("file") as File | null;

    if (!driverId || !docType || !file) {
      return NextResponse.json({ ok: false, error: "Missing fields." }, { status: 400 });
    }

    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `kasi/${driverId}/${Date.now()}_${safeName}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { error: upErr } = await supabaseAdmin.storage
      .from("driver-docs")
      .upload(path, bytes, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }

    const { error: dbErr } = await supabaseAdmin.from("driver_documents").insert({
      driver_id: driverId,
      doc_type: docType,
      file_path: path,
      expires_on: expiresOn || null,
      status: "pending",
    });

    if (dbErr) {
      return NextResponse.json({ ok: false, error: dbErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, path });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(e, "Server error") }, { status: 500 });
  }
}
