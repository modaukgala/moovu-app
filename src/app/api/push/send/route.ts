import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

type PushRow = {
  id: string;
  user_id: string;
  role: "admin" | "driver" | "customer";
  endpoint: string;
  subscription: any;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const role = body?.role ? String(body.role) : null;
    const userIds = Array.isArray(body?.userIds) ? body.userIds.map(String) : null;
    const title = String(body?.title ?? "").trim();
    const messageBody = String(body?.body ?? "").trim();
    const url = String(body?.url ?? "/").trim();

    if (!title || !messageBody) {
      return NextResponse.json(
        { ok: false, error: "Missing title or body." },
        { status: 400 }
      );
    }

    const vapidSubject = process.env.VAPID_SUBJECT || "";
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "";

    if (!vapidSubject || !vapidPublicKey || !vapidPrivateKey) {
      return NextResponse.json(
        { ok: false, error: "Missing VAPID environment variables." },
        { status: 500 }
      );
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    let query = supabase
      .from("push_subscriptions")
      .select("id,user_id,role,endpoint,subscription");

    if (role) {
      query = query.eq("role", role);
    }

    if (userIds && userIds.length > 0) {
      query = query.in("user_id", userIds);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    const rows = (data || []) as PushRow[];
    const payload = JSON.stringify({
      title,
      body: messageBody,
      url,
    });

    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        await webpush.sendNotification(row.subscription, payload);
        sent += 1;
      } catch (err: any) {
        failed += 1;

        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", row.endpoint);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      sent,
      failed,
      total: rows.length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Send failed." },
      { status: 500 }
    );
  }
}