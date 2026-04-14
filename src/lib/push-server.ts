import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

type SendPushParams = {
  userIds?: string[];
  role?: "admin" | "driver" | "customer";
  title: string;
  body: string;
  url?: string;
};

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function ensureVapidConfigured() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY || "";
  const subject =
    process.env.VAPID_SUBJECT || "mailto:admin@moovurides.co.za";

  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys are missing.");
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function sendPushToTargets(params: SendPushParams) {
  ensureVapidConfigured();

  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("push_subscriptions")
    .select("id,user_id,role,endpoint,subscription");

  if (params.userIds && params.userIds.length > 0) {
    query = query.in("user_id", params.userIds);
  } else if (params.role) {
    query = query.eq("role", params.role);
  } else {
    throw new Error("No push target was supplied.");
  }

  const { data: subscriptions, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  if (!subscriptions || subscriptions.length === 0) {
    return {
      ok: true,
      delivered: 0,
      removed: 0,
      message: "No matching push subscriptions were found.",
    };
  }

  const payload = JSON.stringify({
    title: params.title,
    body: params.body,
    url: params.url || "/",
  });

  let delivered = 0;
  let removed = 0;

  for (const row of subscriptions) {
    try {
      await webpush.sendNotification(
        row.subscription as webpush.PushSubscription,
        payload
      );
      delivered += 1;
    } catch (e: any) {
      const statusCode = e?.statusCode;

      if (statusCode === 404 || statusCode === 410) {
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("endpoint", row.endpoint);

        removed += 1;
      }
    }
  }

  return {
    ok: true,
    delivered,
    removed,
    message: "Push send finished.",
  };
}