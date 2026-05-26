import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

const ALLOWED_STATUSES = new Set(["pending", "approved", "active", "inactive", "suspended", "rejected"]);

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await req.json();
    const driverId = String(body?.driverId ?? "").trim();
    const requestedStatus = String(body?.status ?? "").trim();
    const status = requestedStatus === "suspended" ? "inactive" : requestedStatus;

    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Driver ID is required." }, { status: 400 });
    }

    if (!ALLOWED_STATUSES.has(requestedStatus)) {
      return NextResponse.json({ ok: false, error: "Invalid driver status." }, { status: 400 });
    }

    const { error } = await auth.supabaseAdmin
      .from("drivers")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", driverId);

    if (error) {
      console.error("[admin-driver-status] failed to update driver", { driverId, status, error });
      if (error.code === "23514") {
        return NextResponse.json(
          { ok: false, error: "This driver status is not supported by the current database setup." },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { ok: false, error: "Could not update driver status. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, status });
  } catch (error: unknown) {
    console.error("[admin-driver-status] unexpected error", errorMessage(error, "Unknown error"));
    return NextResponse.json(
      { ok: false, error: "Could not update driver status. Please try again." },
      { status: 500 }
    );
  }
}
