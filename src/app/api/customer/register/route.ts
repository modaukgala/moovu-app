import { NextResponse } from "next/server";
import { findRegistrationIdentity, normalizeRegistrationPhone, registrationFailure, isMissingCustomerEmail } from "@/lib/customer/registration";
import { createServiceSupabase } from "@/lib/customer/server";
import {
  buildLegalAcceptanceMetadata,
  legalVersionMatches,
} from "@/lib/legal";

function accountCreationFailure(error: unknown) {
  const failure = registrationFailure(error);
  const internalCode = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
  console.error("[customer-register] registration failed", JSON.stringify({ correlationId: crypto.randomUUID(), code: internalCode.slice(0, 64), category: failure.code }));
  return NextResponse.json({ ok: false, code: failure.code, error: failure.error }, { status: failure.status });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const firstName = String(body?.first_name ?? "").trim();
    const lastName = String(body?.last_name ?? "").trim();
    const customerEmail = String(body?.email ?? "").trim().toLowerCase();
    const normalizedPhone = normalizeRegistrationPhone(body?.phone);
    const password = String(body?.password ?? "");
    const acceptedTerms = body?.acceptedTerms === true;
    const acceptedPrivacy = body?.acceptedPrivacy === true;

    if (!firstName || !lastName) {
      return NextResponse.json(
        { ok: false, error: "First name and surname are required." },
        { status: 400 }
      );
    }

    if (!normalizedPhone) {
      return NextResponse.json(
        { ok: false, error: "Valid cellphone number is required." },
        { status: 400 }
      );
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return NextResponse.json(
        { ok: false, error: "A valid email address is required." },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { ok: false, error: "Password must be at least 6 characters." },
        { status: 400 }
      );
    }

    if (!acceptedTerms || !acceptedPrivacy) {
      return NextResponse.json(
        { ok: false, error: "You must accept the MOOVU Terms of Service and Privacy Policy." },
        { status: 400 }
      );
    }

    if (!legalVersionMatches(body?.termsVersion) || !legalVersionMatches(body?.privacyVersion)) {
      return NextResponse.json(
        { ok: false, error: "Legal document version is out of date. Refresh and try again." },
        { status: 400 }
      );
    }

    const email = customerEmail;
    const supabase = createServiceSupabase();
    const legalMetadata = buildLegalAcceptanceMetadata("customer_signup");

    const { data: existingCustomer, error: customerLookupError } = await supabase
      .from("customers")
      .select("id,auth_user_id")
      .eq("normalized_phone", normalizedPhone)
      .maybeSingle();

    if (customerLookupError) return accountCreationFailure(customerLookupError);

    if (existingCustomer?.id) {
      return NextResponse.json(
        { ok: false, error: "A customer account already exists for this number." },
        { status: 409 }
      );
    }

    const { user: existingCustomerEmailUser, error: listError } =
      await findRegistrationIdentity(options => supabase.auth.admin.listUsers(options), customerEmail);

    if (listError) {
      return accountCreationFailure(listError);
    }

    if (existingCustomerEmailUser) {
      return NextResponse.json(
        { ok: false, code: "ACCOUNT_EXISTS", error: "An account already exists for this email address. Sign in or reset your password to continue." },
        { status: 409 }
      );
    }

    const { data: createdAuth, error: authError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          role: "customer",
          phone: normalizedPhone,
          customer_email: customerEmail,
          first_name: firstName,
          last_name: lastName,
          ...legalMetadata,
        },
      });

    if (authError || !createdAuth?.user) {
      return accountCreationFailure(authError);
    }

    const authUserId = createdAuth.user.id;

    if (!authUserId) {
      return NextResponse.json(
        { ok: false, error: "Could not create or recover auth account." },
        { status: 500 }
      );
    }

    const customerPayload = {
      auth_user_id: authUserId,
      first_name: firstName,
      last_name: lastName,
      email: customerEmail,
      phone: normalizedPhone,
      normalized_phone: normalizedPhone,
      status: "active",
    };

    const { error: customerError } = await supabase.from("customers").upsert(customerPayload, {
      onConflict: "auth_user_id",
    });

    if (customerError && isMissingCustomerEmail(customerError)) {
      const legacyPayload = {
        auth_user_id: customerPayload.auth_user_id,
        first_name: customerPayload.first_name,
        last_name: customerPayload.last_name,
        phone: customerPayload.phone,
        normalized_phone: customerPayload.normalized_phone,
        status: customerPayload.status,
      };
      const { error: legacyCustomerError } = await supabase.from("customers").upsert(
        legacyPayload,
        {
          onConflict: "auth_user_id",
        }
      );

      if (legacyCustomerError) {
        return accountCreationFailure(legacyCustomerError);
      }

      return NextResponse.json({
        ok: true,
        login_email: email,
      });
    }

    if (customerError) {
      return accountCreationFailure(customerError);
    }

    return NextResponse.json({ ok: true, login_email: email });
  } catch (e: unknown) {
    return accountCreationFailure(e);
  }
}
