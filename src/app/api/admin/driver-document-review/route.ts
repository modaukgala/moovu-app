import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const ALLOWED = [
  "pending",
  "approved",
  "rejected",
  "needs_reupload",
] as const;

export async function POST(req: Request) {
  try {
    const { documentId, reviewStatus } = await req.json();

    if (!documentId || !reviewStatus) {
      return NextResponse.json(
        { ok: false, error: "Missing documentId or reviewStatus" },
        { status: 400 }
      );
    }

    if (!ALLOWED.includes(reviewStatus)) {
      return NextResponse.json(
        { ok: false, error: "Invalid reviewStatus" },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("driver_documents")
      .update({
        review_status: reviewStatus,
      })
      .eq("id", documentId);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: `Document review updated to ${reviewStatus}`,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}