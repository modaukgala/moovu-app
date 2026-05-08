import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  isPushRole,
  verifyPushRoleAccess,
  type PushRole,
} from "@/lib/push-auth";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const VALID_APP_TYPES = new Set([
  "web_customer",
  "web_driver",
  "web_admin",
  "android_customer",
  "android_driver",
]);

function defaultAppType(role: PushRole) {
  return role === "driver" ? "web_driver" : role === "admin" ? "web_admin" : "web_customer";
}

function appTypeMatchesRole(appType: string, role: PushRole) {
  if (role === "admin") return appType === "web_admin";
  if (role === "driver") return appType === "web_driver" || appType === "android_driver";
  return appType === "web_customer" || appType === "android_customer";
}

function isMissingColumnError(errorMessage: string, columnName: string) {
  return (
    errorMessage.toLowerCase().includes(`column`) &&
    errorMessage.toLowerCase().includes(columnName.toLowerCase()) &&
    errorMessage.toLowerCase().includes("does not exist")
  );
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!accessToken) {
      return NextResponse.json({ ok: false, error: "Missing access token." }, { status: 401 });
    }

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as unknown;
    const role = isRecord(body) ? String(body.role ?? "").trim() : "";
    const fcmToken = isRecord(body) ? String(body.token ?? "").trim() : "";
    const platform = isRecord(body) ? String(body.platform ?? "").trim() : "";
    const requestedAppType = isRecord(body) ? String(body.appType ?? "").trim() : "";
    const deviceLabel = isRecord(body) ? String(body.deviceLabel ?? "").trim() : "";

    if (!isPushRole(role)) {
      return NextResponse.json({ ok: false, error: "Invalid role." }, { status: 400 });
    }

    if (!fcmToken || fcmToken.length < 20) {
      return NextResponse.json({ ok: false, error: "Invalid FCM token." }, { status: 400 });
    }

    const pushRole = role as PushRole;
    const appType = VALID_APP_TYPES.has(requestedAppType)
      ? requestedAppType
      : defaultAppType(pushRole);

    if (!appTypeMatchesRole(appType, pushRole)) {
      return NextResponse.json({ ok: false, error: "Notification app type does not match role." }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const roleAccess = await verifyPushRoleAccess(supabase, user.id, pushRole);
    if (!roleAccess.ok) {
      return NextResponse.json(
        { ok: false, error: roleAccess.error },
        { status: roleAccess.status }
      );
    }

    const now = new Date().toISOString();

    const rowWithAppType = {
      user_id: user.id,
      role,
      token: fcmToken,
      platform: platform || null,
      app_type: appType,
      user_agent: req.headers.get("user-agent"),
      device_label: deviceLabel || null,
      is_active: true,
      last_seen_at: now,
      updated_at: now,
    };

    const { error } = await supabase.from("fcm_tokens").upsert(rowWithAppType, {
      onConflict: "token",
    });

    if (error && isMissingColumnError(error.message, "app_type")) {
      const rowWithoutAppType = {
        user_id: rowWithAppType.user_id,
        role: rowWithAppType.role,
        token: rowWithAppType.token,
        platform: rowWithAppType.platform,
        user_agent: rowWithAppType.user_agent,
        device_label: rowWithAppType.device_label,
        is_active: rowWithAppType.is_active,
        last_seen_at: rowWithAppType.last_seen_at,
        updated_at: rowWithAppType.updated_at,
      };
      const { error: fallbackError } = await supabase.from("fcm_tokens").upsert(rowWithoutAppType, {
        onConflict: "token",
      });

      if (fallbackError) {
        return NextResponse.json({ ok: false, error: fallbackError.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        message: "FCM notifications enabled. Run the FCM migration to store app type metadata.",
        migrationWarning: "fcm_tokens.app_type is missing",
      });
    }

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: "FCM notifications enabled." });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "FCM registration failed." },
      { status: 500 }
    );
  }
}
