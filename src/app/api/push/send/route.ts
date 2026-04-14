import { NextResponse } from "next/server";
import { sendPushToTargets } from "@/lib/push-server";

export async function POST(req: Request) {
  try {
    const internalKey = req.headers.get("x-push-internal-key") || "";
    const expectedKey = process.env.PUSH_INTERNAL_API_KEY || "";

    if (!expectedKey || internalKey !== expectedKey) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized push request." },
        { status: 401 }
      );
    }

    const body = await req.json();

    const title = String(body?.title ?? "").trim();
    const messageBody = String(body?.body ?? "").trim();
    const url = String(body?.url ?? "/").trim() || "/";
    const role = body?.role ? String(body.role).trim() : undefined;
    const userIds = Array.isArray(body?.userIds)
      ? body.userIds.map((x: unknown) => String(x).trim()).filter(Boolean)
      : undefined;

    if (!title || !messageBody) {
      return NextResponse.json(
        { ok: false, error: "title and body are required." },
        { status: 400 }
      );
    }

    if (!role && (!userIds || userIds.length === 0)) {
      return NextResponse.json(
        { ok: false, error: "Provide either role or userIds." },
        { status: 400 }
      );
    }

    const result = await sendPushToTargets({
      role: role as "admin" | "driver" | "customer" | undefined,
      userIds,
      title,
      body: messageBody,
      url,
    });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Push send failed." },
      { status: 500 }
    );
  }
}