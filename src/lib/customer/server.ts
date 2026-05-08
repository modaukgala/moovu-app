import { createClient } from "@supabase/supabase-js";
import { normalizePhoneZA } from "@/lib/customer/auth";

export function createServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export function createUserScopedSupabase(accessToken: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        persistSession: false,
      },
    }
  );
}

export function readBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
}

function isMissingEmailColumn(error: { message?: string } | null | undefined) {
  return !!error?.message?.toLowerCase().includes("email");
}

async function ensureCustomerProfile(params: {
  supabaseAdmin: ReturnType<typeof createServiceSupabase>;
  user: {
    id: string;
    email?: string | null;
    user_metadata?: Record<string, unknown> | null;
  };
}) {
  const { supabaseAdmin, user } = params;

  const userMeta = user.user_metadata || {};
  const firstName = String(userMeta.first_name ?? "").trim();
  const lastName = String(userMeta.last_name ?? "").trim();
  const customerEmail = String(userMeta.customer_email ?? "").trim().toLowerCase();
  const phoneFromMeta = normalizePhoneZA(
    typeof userMeta.phone === "string" ? userMeta.phone : null
  );
  const phoneFromEmail = user.email
    ? normalizePhoneZA(String(user.email).split("@")[0])
    : null;

  const normalizedPhone = phoneFromMeta || phoneFromEmail;

  if (!firstName || !lastName || !normalizedPhone) {
    return {
      ok: false as const,
      error:
        "Customer profile not found and could not be rebuilt automatically. Please log out and create your customer account again.",
    };
  }

  const profilePayload = {
    auth_user_id: user.id,
    first_name: firstName,
    last_name: lastName,
    email: customerEmail || null,
    phone: normalizedPhone,
    normalized_phone: normalizedPhone,
    status: "active",
  };

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("customers")
    .upsert(
      profilePayload,
      {
        onConflict: "auth_user_id",
      }
    )
    .select("*")
    .single();

  if (insertError && isMissingEmailColumn(insertError)) {
    const legacyProfilePayload = {
      auth_user_id: profilePayload.auth_user_id,
      first_name: profilePayload.first_name,
      last_name: profilePayload.last_name,
      phone: profilePayload.phone,
      normalized_phone: profilePayload.normalized_phone,
      status: profilePayload.status,
    };
    const { data: legacyInserted, error: legacyInsertError } = await supabaseAdmin
      .from("customers")
      .upsert(
        legacyProfilePayload,
        {
          onConflict: "auth_user_id",
        }
      )
      .select("*")
      .single();

    if (legacyInsertError || !legacyInserted) {
      return {
        ok: false as const,
        error: legacyInsertError?.message || "Failed to rebuild customer profile.",
      };
    }

    return {
      ok: true as const,
      customer: legacyInserted,
    };
  }

  if (insertError || !inserted) {
    return {
      ok: false as const,
      error: insertError?.message || "Failed to rebuild customer profile.",
    };
  }

  return {
    ok: true as const,
    customer: inserted,
  };
}

export async function getAuthenticatedCustomer(req: Request) {
  const accessToken = readBearerToken(req);

  if (!accessToken) {
    return { ok: false as const, status: 401, error: "Missing access token." };
  }

  const userScopedSupabase = createUserScopedSupabase(accessToken);
  const {
    data: { user },
    error: userError,
  } = await userScopedSupabase.auth.getUser();

  if (userError || !user) {
    return { ok: false as const, status: 401, error: "Unauthorized." };
  }

  const supabaseAdmin = createServiceSupabase();

  const { data: existingCustomer, error: customerError } = await supabaseAdmin
    .from("customers")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (customerError) {
    return { ok: false as const, status: 500, error: customerError.message };
  }

  let customer = existingCustomer;

  if (!customer) {
    const repaired = await ensureCustomerProfile({
      supabaseAdmin,
      user: {
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata ?? {},
      },
    });

    if (!repaired.ok) {
      return { ok: false as const, status: 404, error: repaired.error };
    }

    customer = repaired.customer;
  }

  return {
    ok: true as const,
    user,
    customer,
    supabaseAdmin,
  };
}
