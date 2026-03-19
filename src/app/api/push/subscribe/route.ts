import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const role = String(body?.role ?? "").trim() as "admin" | "driver" | "customer";
    const userId = String(body?.userId ?? "").trim();
    const subscription = body?.subscription;

    const endpoint = subscription?.endpoint ?? null;
    const p256dh = subscription?.keys?.p256dh ?? null;
    const auth = subscription?.keys?.auth ?? null;

    if (!role || !userId || !endpoint) {
      return NextResponse.json(
        { ok: false, error: "Missing role, userId or endpoint." },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const payload = {
      user_id: userId,
      role,
      endpoint,
      subscription,
      p256dh,
      auth,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(payload, { onConflict: "endpoint" });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Subscription saved.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Subscribe failed." },
      { status: 500 }
    );
  }
}