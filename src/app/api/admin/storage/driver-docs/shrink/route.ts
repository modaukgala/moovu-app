import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireAdminUser } from "@/lib/auth/admin";
import { DOCS_BUCKET, listDriverDocs, needsShrink } from "@/lib/storage/driverDocsMaintenance";

export const maxDuration = 60;
const BATCH = 6;

/**
 * Owner only. Shrinks the next few large JPEG driver documents in place
 * (max 2000 px, JPEG quality 82). Only replaces a file when the result is smaller.
 */
export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (String(auth.profile.role) !== "owner") {
    return NextResponse.json({ ok: false, error: "Owner only." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (body?.confirmBackup !== true) {
    return NextResponse.json({ ok: false, error: "Confirm the backup is saved first." }, { status: 400 });
  }
  const db = auth.supabaseAdmin;
  const pending = (await listDriverDocs(db)).filter(needsShrink);
  const done: Array<{ path: string; before: number; after: number }> = [];
  const failed: Array<{ path: string; error: string }> = [];
  for (const doc of pending.slice(0, BATCH)) {
    try {
      const { data, error } = await db.storage.from(DOCS_BUCKET).download(doc.path);
      if (error || !data) throw new Error(error?.message ?? "download failed");
      const input = Buffer.from(await data.arrayBuffer());
      const output = await sharp(input).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true }).toBuffer();
      if (output.length >= input.length) { failed.push({ path: doc.path, error: "already small" }); continue; }
      const { error: upErr } = await db.storage.from(DOCS_BUCKET).update(doc.path, output, { contentType: "image/jpeg", upsert: true });
      if (upErr) throw new Error(upErr.message);
      done.push({ path: doc.path, before: input.length, after: output.length });
    } catch (e) {
      failed.push({ path: doc.path, error: e instanceof Error ? e.message : "error" });
    }
  }
  return NextResponse.json({ ok: true, done, failed, remaining: Math.max(0, pending.length - done.length - failed.length) });
}
