import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

const ALLOWED = ["pending", "approved", "verified", "rejected", "needs_reupload"] as const;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const { supabaseAdmin } = auth;
    const body = await req.json();
    const documentId = String(body?.documentId ?? "").trim();
    const reviewStatus = String(body?.reviewStatus ?? "").trim();

    if (!documentId || !reviewStatus) {
      return NextResponse.json(
        { ok: false, error: "Missing documentId or reviewStatus" },
        { status: 400 }
      );
    }

    if (!ALLOWED.includes(reviewStatus as (typeof ALLOWED)[number])) {
      return NextResponse.json({ ok: false, error: "Invalid reviewStatus" }, { status: 400 });
    }

    let { error } = await supabaseAdmin
      .from("driver_documents")
      .update({
        review_status: reviewStatus,
        status: reviewStatus === "verified" ? "approved" : reviewStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    if (error?.code === "42703") {
      const retry = await supabaseAdmin
        .from("driver_documents")
        .update({
          review_status: reviewStatus,
          status: reviewStatus === "verified" ? "approved" : reviewStatus,
        })
        .eq("id", documentId);
      error = retry.error;
    }

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: `Document review updated to ${reviewStatus}`,
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(e, "Server error") }, { status: 500 });
  }
}
