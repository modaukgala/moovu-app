import { NextResponse } from "next/server";
import {
  buildLegalAcceptanceMetadata,
  legalVersionMatches,
} from "@/lib/legal";
import { getAuthenticatedCustomer } from "@/lib/customer/server";

export async function POST(req: Request) {
  const auth = await getAuthenticatedCustomer(req);

  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  try {
    const body = await req.json();
    const acceptedTerms = body?.acceptedTerms === true;
    const acceptedPrivacy = body?.acceptedPrivacy === true;

    if (!acceptedTerms || !acceptedPrivacy) {
      return NextResponse.json(
        { ok: false, error: "Terms of Service and Privacy Policy acceptance is required." },
        { status: 400 },
      );
    }

    if (!legalVersionMatches(body?.termsVersion) || !legalVersionMatches(body?.privacyVersion)) {
      return NextResponse.json(
        { ok: false, error: "Legal document version is out of date. Refresh and try again." },
        { status: 400 },
      );
    }

    const metadata = buildLegalAcceptanceMetadata("booking_prompt");

    const { error } = await auth.supabaseAdmin.auth.admin.updateUserById(auth.user.id, {
      user_metadata: {
        ...(auth.user.user_metadata || {}),
        ...metadata,
      },
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, legalAcceptance: metadata });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error." },
      { status: 500 },
    );
  }
}
