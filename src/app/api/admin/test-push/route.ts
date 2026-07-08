import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { sendPushToTokens } from "@/lib/push-server";
import { isPushRole, type PushRole } from "@/lib/push-auth";

type TestPushPlatform = "ios" | "android" | "web" | "unknown";

const VALID_PLATFORMS = new Set<TestPushPlatform>(["ios", "android", "web", "unknown"]);
const VALID_APP_TYPES = new Set([
  "web_customer",
  "web_driver",
  "web_admin",
  "android_customer",
  "android_driver",
  "ios_customer",
  "ios_driver",
  "ios_admin",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIosApnsToken(token: string) {
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

    const token = String(body.token ?? "").trim();
    const rawPlatform = String(body.platform ?? "unknown").trim().toLowerCase();
    const platform: TestPushPlatform = VALID_PLATFORMS.has(rawPlatform as TestPushPlatform)
      ? rawPlatform as TestPushPlatform
      : "unknown";
    const rawAppType = String(body.appType ?? "").trim();
    const appType = VALID_APP_TYPES.has(rawAppType) ? rawAppType : null;
    const role = isPushRole(body.role) ? body.role : null;
    const title = String(body.title ?? "MOOVU test notification").trim();
    const messageBody = String(body.body ?? "This is a visible MOOVU push notification test.").trim();
    const url = String(body.url ?? (role === "driver" ? "/driver" : "/book")).trim() || "/";

    if (!token) {
      return NextResponse.json({ ok: false, error: "token is required." }, { status: 400 });
    }

    if (!title || !messageBody) {
      return NextResponse.json({ ok: false, error: "title and body are required." }, { status: 400 });
    }

    if (platform === "ios" && isIosApnsToken(token)) {
      console.warn("[admin-test-push] APNs token rejected, waiting for FCM token", {
        platform,
        appType,
        role,
        tokenLength: token.length,
      });
      return NextResponse.json(
        { ok: false, error: "This is a raw APNs token. Use the iOS Firebase FCM registration token from fcm_tokens." },
        { status: 400 },
      );
    }

    if (platform === "ios" && token.length <= 100) {
      return NextResponse.json(
        { ok: false, error: "iOS test pushes require a Firebase FCM token longer than 100 characters." },
        { status: 400 },
      );
    }

    console.info("[admin-test-push] sending visible test push", {
      platform,
      appType,
      role,
      tokenSuffix: token.slice(-12),
      tokenLength: token.length,
    });

    const result = await sendPushToTokens(
      [token],
      {
        title,
        body: messageBody,
        url,
        data: {
          type: "notification_test",
          notificationType: "notification_test",
          platform,
          appType,
          role: role ?? undefined,
          url,
        },
      },
      {
        platform,
        appType,
        role: role as PushRole | null,
      },
    );

    return NextResponse.json({
      ok: result.ok,
      platform,
      appType,
      role,
      tokenSuffix: token.slice(-12),
      result,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Test push failed." },
      { status: 500 },
    );
  }
}
