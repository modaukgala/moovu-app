import { NextResponse } from "next/server";
import { customerEmailFromPhone, normalizePhoneZA } from "@/lib/customer/auth";
import { createServiceSupabase } from "@/lib/customer/server";
import {
  buildLegalAcceptanceMetadata,
  legalVersionMatches,
} from "@/lib/legal";

function isMissingEmailColumn(error: { message?: string } | null | undefined) {
  return !!error?.message?.toLowerCase().includes("email");
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const firstName = String(body?.first_name ?? "").trim();
    const lastName = String(body?.last_name ?? "").trim();
    const customerEmail = String(body?.email ?? "").trim().toLowerCase();
    const normalizedPhone = normalizePhoneZA(body?.phone);
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

    const email = customerEmailFromPhone(normalizedPhone);
    const supabase = createServiceSupabase();
    const legalMetadata = buildLegalAcceptanceMetadata("customer_signup");

    const { data: existingCustomer } = await supabase
      .from("customers")
      .select("id,auth_user_id")
      .eq("normalized_phone", normalizedPhone)
      .maybeSingle();

    if (existingCustomer?.id) {
      return NextResponse.json(
        { ok: false, error: "A customer account already exists for this number." },
        { status: 409 }
      );
    }

    const { data: existingUsers, error: listError } =
      await supabase.auth.admin.listUsers();

    if (listError) {
      return NextResponse.json(
        { ok: false, error: listError.message },
        { status: 500 }
      );
    }

    const existingCustomerEmailUser = existingUsers.users.find((u) => {
      const authEmail = String(u.email ?? "").toLowerCase();
      const metadataEmail = String(u.user_metadata?.customer_email ?? "").toLowerCase();
      return authEmail === customerEmail || metadataEmail === customerEmail;
    });

    if (existingCustomerEmailUser) {
      return NextResponse.json(
        { ok: false, error: "A customer account already exists for this email address." },
        { status: 409 }
      );
    }

    const existingAuthUser = existingUsers.users.find(
      (u) => (u.email || "").toLowerCase() === email.toLowerCase()
    );

    let authUserId: string | null = null;

    if (existingAuthUser) {
      authUserId = existingAuthUser.id;

      const { error: updateError } = await supabase.auth.admin.updateUserById(
        existingAuthUser.id,
        {
          password,
          user_metadata: {
            ...(existingAuthUser.user_metadata || {}),
            role: "customer",
            phone: normalizedPhone,
            customer_email: customerEmail,
            first_name: firstName,
            last_name: lastName,
            ...legalMetadata,
          },
        }
      );

      if (updateError) {
        return NextResponse.json(
          { ok: false, error: updateError.message },
          { status: 500 }
        );
      }
    } else {
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
        return NextResponse.json(
          { ok: false, error: authError?.message || "Failed to create auth account." },
          { status: 500 }
        );
      }

      authUserId = createdAuth.user.id;
    }

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

    if (customerError && isMissingEmailColumn(customerError)) {
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
        return NextResponse.json(
          { ok: false, error: legacyCustomerError.message },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        warning: "Customer created. Run the customer email SQL migration to persist customers.email.",
      });
    }

    if (customerError) {
      return NextResponse.json(
        { ok: false, error: customerError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error." },
      { status: 500 }
    );
  }
}
