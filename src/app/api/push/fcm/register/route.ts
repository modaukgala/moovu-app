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

const VALID_PLATFORMS = new Set(["android", "ios", "web", "unknown"]);

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

function missingColumnName(errorMessage: string, row: Record<string, unknown>) {
  const lower = errorMessage.toLowerCase();
  if (!lower.includes("column") || !lower.includes("does not exist")) return null;

  return Object.keys(row).find((key) => lower.includes(key.toLowerCase())) ?? null;
}

async function upsertFcmToken(
  supabase: unknown,
  row: Record<string, unknown>,
) {
  const nextRow = { ...row };
  const removedColumns: string[] = [];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const table = (supabase as { from: (table: string) => unknown }).from("fcm_tokens") as {
      upsert: (
        values: Record<string, unknown>,
        options: { onConflict: string },
      ) => Promise<{ error: { message: string } | null }>;
    };
    const { error } = await table.upsert(nextRow, {
      onConflict: "token",
    });

    if (!error) return { ok: true as const, removedColumns };

    const missingColumn = missingColumnName(error.message, nextRow);
    if (!missingColumn) return { ok: false as const, error };

    delete nextRow[missingColumn];
    removedColumns.push(missingColumn);
  }

  return {
    ok: false as const,
    error: { message: "Could not save FCM token because the fcm_tokens schema is missing required columns." },
  };
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
    const rawPlatform = isRecord(body) ? String(body.platform ?? "").trim() : "";
    const platform = VALID_PLATFORMS.has(rawPlatform) ? rawPlatform : "unknown";
    const requestedAppType = isRecord(body) ? String(body.appType ?? "").trim() : "";
    const appSource = isRecord(body) ? String(body.appSource ?? "").trim() : "";
    const deviceId = isRecord(body) ? String(body.deviceId ?? "").trim() : "";
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

    if (appSource && !appSource.endsWith(`_${pushRole}`)) {
      return NextResponse.json({ ok: false, error: "Notification app source does not match role." }, { status: 400 });
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

    const tokenRow: Record<string, unknown> = {
      user_id: user.id,
      role,
      token: fcmToken,
      platform,
      app_type: appType,
      app_source: appSource || appType,
      device_id: deviceId || null,
      user_agent: req.headers.get("user-agent"),
      device_label: deviceLabel || null,
      is_active: true,
      last_used_at: now,
      last_seen_at: now,
      updated_at: now,
    };

    const result = await upsertFcmToken(supabase, tokenRow);

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error.message }, { status: 500 });
    }

    if (result.removedColumns.length > 0 || isMissingColumnError(result.removedColumns.join(","), "app_type")) {
      return NextResponse.json({
        ok: true,
        message: "FCM notifications enabled. Run the FCM migration to store all device metadata.",
        migrationWarning: `fcm_tokens missing columns: ${result.removedColumns.join(", ")}`,
      });
    }

    return NextResponse.json({ ok: true, message: "FCM notifications enabled." });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "FCM registration failed." },
      { status: 500 }
    );
  }
}
