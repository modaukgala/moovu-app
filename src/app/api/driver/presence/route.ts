import { NextResponse } from "next/server";
import { getUserFromBearer } from "@/app/api/driver/utils";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const user = await getUserFromBearer(req);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { data: mapping, error } = await supabaseAdmin.from("driver_accounts").select("driver_id")
    .eq("user_id", user.id).maybeSingle();
  if (error || !mapping?.driver_id) return NextResponse.json({ error: "Driver link unavailable." }, { status: 403 });
  const { data, error: presenceError } = await supabaseAdmin.rpc("refresh_driver_offer_presence", { p_driver: mapping.driver_id });
  if (presenceError) return NextResponse.json({ error: "Presence update unavailable." }, { status: 503 });
  return NextResponse.json({ ok: data === true }, { headers: { "Cache-Control": "no-store" } });
}
