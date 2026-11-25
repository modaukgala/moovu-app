import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { DOCS_BUCKET, listDriverDocs, needsShrink } from "@/lib/storage/driverDocsMaintenance";

/** Owner/admin: list driver documents with short-lived download links (for the backup). */
export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!["owner", "admin"].includes(String(auth.profile.role))) {
    return NextResponse.json({ ok: false, error: "Owner or admin only." }, { status: 403 });
  }
  const docs = await listDriverDocs(auth.supabaseAdmin);
  const withLinks = new URL(req.url).searchParams.get("links") === "1";
  const rows = [];
  for (const d of docs) {
    let url: string | null = null;
    if (withLinks) {
      const { data } = await auth.supabaseAdmin.storage.from(DOCS_BUCKET).createSignedUrl(d.path, 3600);
      url = data?.signedUrl ?? null;
    }
    rows.push({ ...d, url, shrinkable: needsShrink(d) });
  }
  const total = docs.reduce((a, d) => a + d.size, 0);
  const shrinkable = docs.filter(needsShrink);
  return NextResponse.json({ ok: true, count: docs.length, totalBytes: total, shrinkableCount: shrinkable.length, shrinkableBytes: shrinkable.reduce((a, d) => a + d.size, 0), docs: rows });
}
