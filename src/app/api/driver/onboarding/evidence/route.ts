import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { phase6Auth, phase6Owned } from "@/lib/drivers/phase6Server";
import { PHASE6_SECTIONS, phase6Editable, type Phase6Section } from "@/lib/drivers/phase6Policy";
import { preparePhase6Image } from "@/lib/drivers/phase6Image";

export const runtime = "nodejs";
export async function POST(req: Request) {
  if (!(await phase6Auth(req))) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > 8500000) return NextResponse.json({ error: "Image is too large." }, { status: 413 });
  const reader = req.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Capture is missing." }, { status: 400 });
  const chunks: Uint8Array[] = []; let received = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    received += chunk.value.byteLength;
    if (received > 8500000) { await reader.cancel(); return NextResponse.json({ error: "Image is too large." }, { status: 413 }); }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(received); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const form = await new Response(bytes, { headers: { "Content-Type": req.headers.get("content-type") ?? "" } }).formData().catch(() => null);
  const id = String(form?.get("application") ?? "");
  const section = String(form?.get("section") ?? "") as Phase6Section;
  const owned = await phase6Owned(req, id);
  if (!owned || !PHASE6_SECTIONS.includes(section) || !phase6Editable(owned.application, section)) return NextResponse.json({ error: "Evidence cannot be changed." }, { status: 403 });
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an image." }, { status: 400 });
  if (file.size > 8388608) return NextResponse.json({ error: "Choose an image under 8 MB." }, { status: 413 });
  const source = String(form?.get("source") ?? "unknown");
  if (!["camera", "gallery", "file", "unknown"].includes(source)) return NextResponse.json({ error: "Invalid capture source." }, { status: 400 });
  let image;
  try { image = await preparePhase6Image(new Uint8Array(await file.arrayBuffer())); }
  catch { return NextResponse.json({ error: "Choose a clear JPEG, PNG or WebP image under 8 MB." }, { status: 400 }); }
  const uploadId = randomUUID();
  const path = `${owned.application.driver_id}/${id}/${uploadId}.jpg`;
  const row = await supabaseAdmin.from("phase6_uploads").insert({ id: uploadId, application_id: id, section, object_path: path, source }).select("id").single();
  if (row.error) return NextResponse.json({ error: "Evidence could not be reserved." }, { status: 409 });
  const stored = await supabaseAdmin.storage.from("phase6-evidence").upload(path, image.buffer, { contentType: image.mime, upsert: false });
  if (stored.error) {
    await supabaseAdmin.from("phase6_uploads").update({ state: "FAILED" }).eq("id", uploadId);
    return NextResponse.json({ error: "Upload failed. Please retry." }, { status: 503 });
  }
  const finalized = await supabaseAdmin.from("phase6_uploads").update({ state: "VALIDATED", digest: image.digest, mime: image.mime, bytes: image.bytes, width: image.width, height: image.height, finalized_at: new Date().toISOString() }).eq("id", uploadId).eq("state", "PENDING");
  if (finalized.error) return NextResponse.json({ error: "Upload is awaiting reconciliation. Please retry." }, { status: 409 });
  return NextResponse.json({ evidence: uploadId }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: Request) {
  const query = new URL(req.url).searchParams;
  const owned = await phase6Owned(req, query.get("application") ?? "", query.get("review") === "true");
  if (!owned) return NextResponse.json({ error: "Evidence unavailable." }, { status: 403 });
  const row = await supabaseAdmin.from("phase6_uploads").select("object_path").eq("id", query.get("evidence") ?? "").eq("application_id", owned.application.id).eq("state", "VALIDATED").maybeSingle();
  if (!row.data) return NextResponse.json({ error: "Evidence unavailable." }, { status: 404 });
  const audit = await supabaseAdmin.from("phase6_access_audit").insert({ actor_id: owned.user.id, application_id: owned.application.id, upload_id: query.get("evidence"), action: "VIEW_EVIDENCE" });
  if (audit.error) return NextResponse.json({ error: "Evidence access could not be recorded safely." }, { status: 503 });
  const object = await supabaseAdmin.storage.from("phase6-evidence").download(row.data.object_path);
  if (!object.data) return NextResponse.json({ error: "Evidence unavailable." }, { status: 503 });
  return new Response(await object.data.arrayBuffer(), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline; filename=capture.jpg" } });
}
