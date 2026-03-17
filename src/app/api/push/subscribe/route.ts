import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const role = body?.role as "admin" | "driver" | "customer" | undefined;
    const userId = body?.userId as string | undefined;
    const subscription = body?.subscription;

    if (!role || !userId || !subscription?.endpoint) {
      return NextResponse.json(
        { ok: false, error: "Missing role, userId or subscription." },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: userId,
          role,
          endpoint: subscription.endpoint,
          subscription,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" }
      );

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Subscribe failed" },
      { status: 500 }
    );
  }
}