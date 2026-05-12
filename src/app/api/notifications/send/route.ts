import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import {
  sendPushNotification,
  sendPushToRole,
  sendPushToTokens,
} from "@/lib/push-server";
import { isPushRole, type PushRole } from "@/lib/push-auth";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function parseData(value: unknown) {
  if (!isRecord(value)) return undefined;

  const data: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      data[key] = item;
    }
  }
  return data;
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

    const title = String(body.title ?? "").trim();
    const messageBody = String(body.body ?? "").trim();
    const url = String(body.url ?? "/").trim() || "/";
    const role = isPushRole(body.role) ? body.role : undefined;
    const userId = String(body.userId ?? "").trim();
    const userIds = stringArray(body.userIds);
    const tokens = stringArray(body.tokens);
    const data = parseData(body.data);

    if (!title || !messageBody) {
      return NextResponse.json({ ok: false, error: "title and body are required." }, { status: 400 });
    }

    if (body.role && !role) {
      return NextResponse.json({ ok: false, error: "Invalid role." }, { status: 400 });
    }

    if (tokens.length > 0) {
      const result = await sendPushToTokens(tokens, {
        title,
        body: messageBody,
        url,
        data,
      });
      return NextResponse.json(result);
    }

    if (userId) {
      if (!role) {
        return NextResponse.json({ ok: false, error: "role is required when sending to userId." }, { status: 400 });
      }

      const result = await sendPushNotification({
        userId,
        role: role as PushRole,
        title,
        body: messageBody,
        data: {
          ...(data ?? {}),
          url,
        },
      });
      return NextResponse.json(result);
    }

    if (userIds.length > 0) {
      if (!role) {
        return NextResponse.json({ ok: false, error: "role is required when sending to userIds." }, { status: 400 });
      }

      const results = await Promise.all(
        userIds.map((targetUserId) =>
          sendPushNotification({
            userId: targetUserId,
            role,
            title,
            body: messageBody,
            data: {
              ...(data ?? {}),
              url,
            },
          })
        )
      );

      return NextResponse.json({
        ok: true,
        delivered: results.reduce((sum, result) => sum + Number(result.delivered || 0), 0),
        removed: results.reduce((sum, result) => sum + Number(result.removed || 0), 0),
        failed: results.reduce((sum, result) => sum + Number(result.failed || 0), 0),
        failures: results.flatMap((result) => result.failures || []),
        message: "Push send finished.",
      });
    }

    if (role) {
      const result = await sendPushToRole(role, {
        title,
        body: messageBody,
        url,
        data,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ ok: false, error: "Provide tokens, userId, userIds, or role." }, { status: 400 });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Push send failed." },
      { status: 500 },
    );
  }
}
