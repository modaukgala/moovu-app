import { NextResponse } from "next/server";
import { customerEmailFromPhone, normalizePhoneZA } from "@/lib/customer/auth";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { getLegalAcceptanceStatus } from "@/lib/legal";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isMissingEmailColumn(error: { message?: string } | null | undefined) {
  return !!error?.message?.toLowerCase().includes("email");
}

function customerEmailFromAuth(auth: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}) {
  const metadataEmail = String(auth.user_metadata?.customer_email ?? "").trim().toLowerCase();
  if (metadataEmail) return metadataEmail;

  const authEmail = String(auth.email ?? "").trim().toLowerCase();
  return authEmail.endsWith("@customer.moovu.local") ? "" : authEmail;
}

export async function GET(req: Request) {
  const auth = await getAuthenticatedCustomer(req);

  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  return NextResponse.json({
    ok: true,
    customer: {
      id: auth.customer.id,
      first_name: auth.customer.first_name,
      last_name: auth.customer.last_name,
      email: auth.customer.email ?? customerEmailFromAuth(auth.user),
      phone: auth.customer.phone,
      status: auth.customer.status,
    },
    legalAcceptance: getLegalAcceptanceStatus(
      auth.user.user_metadata ?? {},
      auth.customer as Record<string, unknown>,
    ),
  });
}

export async function PATCH(req: Request) {
  const auth = await getAuthenticatedCustomer(req);

  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => null);
  const firstName = String(body?.first_name ?? "").trim();
  const lastName = String(body?.last_name ?? "").trim();
  const email = String(body?.email ?? "").trim().toLowerCase();
  const phone = normalizePhoneZA(body?.phone);

  if (!firstName || !lastName) {
    return NextResponse.json(
      { ok: false, error: "First name and surname are required." },
      { status: 400 }
    );
  }

  if (!phone) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid cellphone number." },
      { status: 400 }
    );
  }

  if (!isValidEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid email address." },
      { status: 400 }
    );
  }

  const { supabaseAdmin, customer, user } = auth;

  const { data: phoneOwner, error: phoneCheckError } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("normalized_phone", phone)
    .neq("id", customer.id)
    .maybeSingle();

  if (phoneCheckError) {
    console.error("[customer-me] phone duplicate check failed", phoneCheckError);
    return NextResponse.json(
      { ok: false, error: "Could not check cellphone number. Please try again." },
      { status: 500 }
    );
  }

  if (phoneOwner?.id) {
    return NextResponse.json(
      { ok: false, error: "This cellphone number is already linked to another customer account." },
      { status: 409 }
    );
  }

  const { data: emailOwner, error: emailCheckError } = await supabaseAdmin
    .from("customers")
    .select("id")
    .eq("email", email)
    .neq("id", customer.id)
    .maybeSingle();

  if (emailCheckError && !isMissingEmailColumn(emailCheckError)) {
    console.error("[customer-me] email duplicate check failed", emailCheckError);
    return NextResponse.json(
      { ok: false, error: "Could not check email address. Please try again." },
      { status: 500 }
    );
  }

  if (emailOwner?.id) {
    return NextResponse.json(
      { ok: false, error: "This email address is already linked to another customer account." },
      { status: 409 }
    );
  }

  const currentMetadata = user.user_metadata ?? {};
  const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    email: customerEmailFromPhone(phone),
    email_confirm: true,
    user_metadata: {
      ...currentMetadata,
      role: "customer",
      first_name: firstName,
      last_name: lastName,
      phone,
      customer_email: email,
    },
  });

  if (authUpdateError) {
    console.error("[customer-me] auth metadata update failed", authUpdateError);
    return NextResponse.json(
      { ok: false, error: "Could not update your account details. Please try again." },
      { status: 500 }
    );
  }

  const payload = {
    first_name: firstName,
    last_name: lastName,
    email,
    phone,
    normalized_phone: phone,
  };

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("customers")
    .update(payload)
    .eq("id", customer.id)
    .select("id,first_name,last_name,email,phone,status")
    .single();

  if (updateError && isMissingEmailColumn(updateError)) {
    const { data: legacyUpdated, error: legacyUpdateError } = await supabaseAdmin
      .from("customers")
      .update({
        first_name: firstName,
        last_name: lastName,
        phone,
        normalized_phone: phone,
      })
      .eq("id", customer.id)
      .select("id,first_name,last_name,phone,status")
      .single();

    if (legacyUpdateError || !legacyUpdated) {
      console.error("[customer-me] legacy customer update failed", legacyUpdateError);
      return NextResponse.json(
        { ok: false, error: "Could not update your account details. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      customer: {
        ...legacyUpdated,
        email,
      },
      warning: "Account updated. Run the customer email SQL migration to persist customers.email.",
    });
  }

  if (updateError || !updated) {
    console.error("[customer-me] customer update failed", updateError);
    return NextResponse.json(
      { ok: false, error: "Could not update your account details. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    customer: updated,
  });
}
