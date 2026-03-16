import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import webpush from "web-push";

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function POST(req: Request) {
  try {
    const { userIds, role, title, body, url } = await req.json();

    if ((!Array.isArray(userIds) || userIds.length === 0) && !role) {
      return NextResponse.json({ ok: false, error: "Provide userIds or role" }, { status: 400 });
    }

    let query = supabaseAdmin.from("push_subscriptions").select("*");

    if (Array.isArray(userIds) && userIds.length > 0) {
      query = query.in("user_id", userIds);
    }

    if (role) {
      query = query.eq("role", role);
    }

    const { data: subs, error } = await query;

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const results = await Promise.allSettled(
      (subs ?? []).map((sub: any) =>
        webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          JSON.stringify({
            title: title || "MOOVU",
            body: body || "You have a new notification.",
            url: url || "/",
          })
        )
      )
    );

    return NextResponse.json({
      ok: true,
      sent: results.filter((r) => r.status === "fulfilled").length,
      failed: results.filter((r) => r.status === "rejected").length,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}