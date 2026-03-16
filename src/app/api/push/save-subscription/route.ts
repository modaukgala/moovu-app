import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

async function getUserFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  // @ts-ignore
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) return null;
  return data?.user ?? null;
}

export async function POST(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }

    const { subscription, role } = await req.json();

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json({ ok: false, error: "Invalid subscription payload" }, { status: 400 });
    }

    if (!["admin", "driver"].includes(role)) {
      return NextResponse.json({ ok: false, error: "Invalid role" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          role,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" }
      );

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}