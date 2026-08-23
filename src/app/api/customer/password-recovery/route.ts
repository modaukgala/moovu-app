import { NextResponse } from "next/server";
import { normalizePhoneZA } from "@/lib/customer/auth";
import { createServiceSupabase } from "@/lib/customer/server";
import { getSiteUrl } from "@/lib/config/env";
import { takeRateLimit } from "@/lib/server/requestControl";

const NEUTRAL_RESPONSE =
  "If an account matches these details, we’ll send recovery instructions.";

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(req: Request) {
  const response = () =>
    NextResponse.json({ ok: true, message: NEUTRAL_RESPONSE }, { status: 202 });

  try {
    const rateLimit = takeRateLimit(req, "customer-password-recovery", {
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });
    if (!rateLimit.ok) return response();

    const body = await req.json().catch(() => null);
    const identifier = String(body?.identifier ?? "").trim().toLowerCase();
    const registeredEmail = String(body?.email ?? "").trim().toLowerCase();
    const normalizedPhone = normalizePhoneZA(identifier);

    if (!validEmail(registeredEmail) || (!normalizedPhone && !validEmail(identifier))) {
      return response();
    }

    const supabase = createServiceSupabase();
    let customerQuery = supabase
      .from("customers")
      .select("id,auth_user_id,email,first_name,last_name")
      .eq("email", registeredEmail);

    if (normalizedPhone) {
      customerQuery = customerQuery.eq("normalized_phone", normalizedPhone);
    }

    const { data: customer } = await customerQuery.maybeSingle();
    if (!customer?.auth_user_id) return response();

    const { data: authResult } = await supabase.auth.admin.getUserById(customer.auth_user_id);
    const authUser = authResult.user;
    const authEmail = String(authUser?.email ?? "").trim().toLowerCase();
    const metadataEmail = String(authUser?.user_metadata?.customer_email ?? "")
      .trim()
      .toLowerCase();

    if (
      !authUser ||
      authEmail.endsWith("@customer.moovu.local") ||
      authEmail !== registeredEmail ||
      (metadataEmail && metadataEmail !== registeredEmail)
    ) {
      return response();
    }

    const origin = getSiteUrl().replace(/\/$/, "");
    const { error } = await supabase.auth.resetPasswordForEmail(authEmail, {
      redirectTo: `${origin}/customer/auth/reset`,
    });

    if (error) {
      console.error("[customer-password-recovery] reset request failed", {
        code: error.code,
        message: error.message,
      });
    }

    await supabase
      .from("customer_security_events")
      .insert({
        customer_id: customer.id,
        event_type: "password_recovery_requested",
        event_metadata: { channel: "email" },
      })
      .then(({ error: auditError }) => {
        if (auditError && auditError.code !== "42P01") {
          console.error("[customer-password-recovery] audit insert failed", auditError);
        }
      });

    return response();
  } catch (error) {
    console.error("[customer-password-recovery] request failed", error);
    return response();
  }
}
