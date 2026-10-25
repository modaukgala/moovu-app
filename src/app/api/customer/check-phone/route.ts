import { NextResponse } from "next/server";
import { customerEmailFromPhone } from "@/lib/customer/auth";
import { createServiceSupabase } from "@/lib/customer/server";
import { findRegistrationIdentity, normalizeRegistrationPhone } from "@/lib/customer/registration";

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const identifier = String(body?.identifier ?? body?.phone ?? "").trim().toLowerCase();
    const normalizedPhone = normalizeRegistrationPhone(identifier);
    const identifierIsEmail = isEmail(identifier);

    if (!normalizedPhone && !identifierIsEmail) {
      return NextResponse.json(
        { ok: false, error: "Enter a valid email address or cellphone number." },
        { status: 400 }
      );
    }

    const supabase = createServiceSupabase();

    if (identifierIsEmail) {
      const { user: authUser, error: listError } = await findRegistrationIdentity(
        options => supabase.auth.admin.listUsers(options), identifier);

      if (listError) {
        return NextResponse.json({ ok: false, error: "Account lookup is temporarily unavailable. Please try again." }, { status: 503 });
      }

      if (!authUser) {
        return NextResponse.json({
          ok: true,
          exists: false,
          normalized_phone: null,
          login_email: null,
        });
      }

      const { data: customer, error } = await supabase
        .from("customers")
        .select("id,first_name,last_name,normalized_phone,auth_user_id")
        .eq("auth_user_id", authUser.id)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ ok: false, error: "Account lookup is temporarily unavailable. Please try again." }, { status: 503 });
      }

      return NextResponse.json({
        ok: true,
        exists: true,
        first_name: customer?.first_name ?? null,
        last_name: customer?.last_name ?? null,
        normalized_phone: customer?.normalized_phone ?? null,
        login_email: authUser.email ?? null,
      });
    }

    const { data: customer, error } = await supabase
      .from("customers")
      .select("id,first_name,last_name,normalized_phone,auth_user_id")
      .eq("normalized_phone", normalizedPhone)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: "Account lookup is temporarily unavailable. Please try again." }, { status: 503 });
    }

    let loginEmail = normalizedPhone ? customerEmailFromPhone(normalizedPhone) : null;
    if (customer?.auth_user_id) {
      const { data: authUserResult } = await supabase.auth.admin.getUserById(customer.auth_user_id);
      loginEmail = authUserResult.user?.email ?? loginEmail;
    }

    return NextResponse.json({
      ok: true,
      exists: !!customer,
      first_name: customer?.first_name ?? null,
      last_name: customer?.last_name ?? null,
      normalized_phone: normalizedPhone,
      login_email: loginEmail,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Account lookup is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
}
