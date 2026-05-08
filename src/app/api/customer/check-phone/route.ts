import { NextResponse } from "next/server";
import { customerEmailFromPhone, normalizePhoneZA } from "@/lib/customer/auth";
import { createServiceSupabase } from "@/lib/customer/server";

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const identifier = String(body?.identifier ?? body?.phone ?? "").trim().toLowerCase();
    const normalizedPhone = normalizePhoneZA(identifier);
    const identifierIsEmail = isEmail(identifier);

    if (!normalizedPhone && !identifierIsEmail) {
      return NextResponse.json(
        { ok: false, error: "Enter a valid email address or cellphone number." },
        { status: 400 }
      );
    }

    const supabase = createServiceSupabase();

    if (identifierIsEmail) {
      const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers();

      if (listError) {
        return NextResponse.json({ ok: false, error: listError.message }, { status: 500 });
      }

      const authUser = existingUsers.users.find((user) => {
        const authEmail = String(user.email ?? "").toLowerCase();
        const customerEmail = String(user.user_metadata?.customer_email ?? "").toLowerCase();
        return authEmail === identifier || customerEmail === identifier;
      });

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
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        exists: !!customer,
        first_name: customer?.first_name ?? (String(authUser.user_metadata?.first_name ?? "") || null),
        last_name: customer?.last_name ?? (String(authUser.user_metadata?.last_name ?? "") || null),
        normalized_phone: customer?.normalized_phone ?? null,
        login_email: authUser.email ?? null,
      });
    }

    const { data: customer, error } = await supabase
      .from("customers")
      .select("id,first_name,last_name,normalized_phone")
      .eq("normalized_phone", normalizedPhone)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      exists: !!customer,
      first_name: customer?.first_name ?? null,
      last_name: customer?.last_name ?? null,
      normalized_phone: normalizedPhone,
      login_email: normalizedPhone ? customerEmailFromPhone(normalizedPhone) : null,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error." },
      { status: 500 }
    );
  }
}
