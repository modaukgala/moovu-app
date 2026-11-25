import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { expireDriverSubscriptions } from "@/lib/subscriptions/expireDriverSubscriptions";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    if (!isFinancialAdminRole(auth.profile.role)) {
      return NextResponse.json({ ok: false, error: "Financial Admin access required." }, { status: 403 });
    }

    const result = await expireDriverSubscriptions();

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error || "Failed to expire subscriptions." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message:
        result.expiredCount > 0
          ? `${result.expiredCount} driver subscription(s) marked as expired.`
          : "No expired subscriptions found.",
      expiredCount: result.expiredCount,
      driverIds: result.driverIds ?? [],
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Server error.") },
      { status: 500 }
    );
  }
}
