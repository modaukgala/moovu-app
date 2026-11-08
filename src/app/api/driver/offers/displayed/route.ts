import { NextResponse } from "next/server";
import { getUserFromBearer } from "@/app/api/driver/utils";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (Number(req.headers.get("content-length") ?? 0) > 2048) return NextResponse.json({ error: "Request too large." }, { status: 413 });
  const body = await req.json().catch(() => null) as { offerId?: unknown } | null;
  if (typeof body?.offerId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.offerId)) {
    return NextResponse.json({ error: "Invalid offer." }, { status: 400 });
  }
  const { error } = await supabaseAdmin.rpc("record_driver_offer_receipt", {
    p_offer: body.offerId, p_user: user.id, p_type: "DISPLAYED",
  });
  return NextResponse.json({ ok: !error }, { status: error ? 503 : 200 });
}
