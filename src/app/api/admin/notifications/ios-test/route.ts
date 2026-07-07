import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminUser } from "@/lib/auth/admin";
import { sendPushToTokens } from "@/lib/push-server";
import { isPushRole, type PushRole } from "@/lib/push-auth";

type IosAppType = "ios_customer" | "ios_driver";

type FcmTokenRow = {
  id: string;
  user_id: string | null;
  role: PushRole | null;
  token: string;
  platform: string | null;
  app_type: string | null;
  device_id: string | null;
  enabled: boolean | null;
  is_active: boolean | null;
  last_seen_at: string | null;
  updated_at: string | null;
};

const IOS_APP_TYPES = new Set<IosAppType>(["ios_customer", "ios_driver"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIosAppType(value: string): value is IosAppType {
  return IOS_APP_TYPES.has(value as IosAppType);
}

function isIosApnsDeviceToken(token: string) {
  return /^[a-f0-9]{64}$/i.test(token.trim());
}

async function isAuthorized(req: Request) {
  const internalKey = req.headers.get("x-push-internal-key") || "";
  const expectedKey = process.env.PUSH_INTERNAL_API_KEY || "";

  if (expectedKey && internalKey === expectedKey) {
    return { ok: true as const };
  }

  const admin = await requireAdminUser(req);
  if (!admin.ok) {
    return { ok: false as const, error: admin.error, status: admin.status };
  }

  return { ok: true as const };
}

export async function POST(req: Request) {
  try {
    const auth = await isAuthorized(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = (await req.json().catch(() => null)) as unknown;
    if (!isRecord(body)) {
      return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
    }

    const tokenId = String(body.tokenId ?? "").trim();
    const userId = String(body.userId ?? "").trim();
    const role = isPushRole(body.role) ? body.role : undefined;
    const requestedAppType = String(body.appType ?? "").trim();
    const appType = requestedAppType ? (isIosAppType(requestedAppType) ? requestedAppType : null) : undefined;
    const title = String(body.title ?? "MOOVU iOS visible push test").trim();
    const messageBody = String(body.body ?? "This is a visible iOS background notification test.").trim();
    const url = String(body.url ?? (appType === "ios_driver" ? "/driver" : "/book")).trim() || "/";

    if (requestedAppType && !appType) {
      return NextResponse.json({ ok: false, error: "appType must be ios_customer or ios_driver." }, { status: 400 });
    }

    if (!tokenId && !userId) {
      return NextResponse.json(
        { ok: false, error: "Provide tokenId, or provide userId with optional role/appType." },
        { status: 400 },
      );
    }

    if (!title || !messageBody) {
      return NextResponse.json({ ok: false, error: "title and body are required." }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    let query = supabase
      .from("fcm_tokens")
      .select("id,user_id,role,token,platform,app_type,device_id,enabled,is_active,last_seen_at,updated_at")
      .eq("is_active", true)
      .eq("enabled", true)
      .eq("platform", "ios");

    if (tokenId) {
      query = query.eq("id", tokenId);
    } else {
      query = query.eq("user_id", userId);
      if (role) query = query.eq("role", role);
      if (appType) query = query.eq("app_type", appType);
    }

    const { data, error } = await query
      .order("last_seen_at", { ascending: false })
      .limit(1);
    if (error) {
      console.error("[ios-push-test] token lookup failed", { reason: error.message });
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const row = (data?.[0] ?? null) as FcmTokenRow | null;
    if (!row) {
      return NextResponse.json({ ok: false, error: "No active iOS FCM token matched the request." }, { status: 404 });
    }

    const rowAppType = String(row.app_type ?? "");
    if (row.platform !== "ios" || !isIosAppType(rowAppType)) {
      return NextResponse.json(
        { ok: false, error: "Selected token is not an iOS Customer or iOS Driver token." },
        { status: 400 },
      );
    }

    if (isIosApnsDeviceToken(row.token)) {
      console.warn("[ios-push-test] raw APNs token rejected", {
        tokenId: row.id,
        userId: row.user_id,
        role: row.role,
        appType: row.app_type,
      });
      return NextResponse.json(
        { ok: false, error: "Selected token is a raw APNs token. Re-register the iOS app to save an FCM token." },
        { status: 400 },
      );
    }

    console.info("[ios-push-test] sending visible iOS notification", {
      tokenId: row.id,
      userId: row.user_id,
      role: row.role,
      platform: row.platform,
      appType: row.app_type,
      deviceId: row.device_id,
      tokenSuffix: row.token.slice(-12),
    });

    const result = await sendPushToTokens([row.token], {
      title,
      body: messageBody,
      url,
      data: {
        type: "notification_test",
        notificationType: "notification_test",
        appType: rowAppType,
        role: row.role ?? undefined,
        url,
      },
    });

    return NextResponse.json({
      ok: result.ok,
      token: {
        id: row.id,
        userId: row.user_id,
        role: row.role,
        platform: row.platform,
        appType: row.app_type,
        deviceId: row.device_id,
        tokenSuffix: row.token.slice(-12),
        lastSeenAt: row.last_seen_at,
        updatedAt: row.updated_at,
      },
      result,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "iOS push test failed." },
      { status: 500 },
    );
  }
}
