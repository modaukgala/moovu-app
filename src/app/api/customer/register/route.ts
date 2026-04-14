import { NextResponse } from "next/server";
import { customerEmailFromPhone, normalizePhoneZA } from "@/lib/customer/auth";
import { createServiceSupabase } from "@/lib/customer/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const firstName = String(body?.first_name ?? "").trim();
    const lastName = String(body?.last_name ?? "").trim();
    const normalizedPhone = normalizePhoneZA(body?.phone);
    const password = String(body?.password ?? "");

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

    if (password.length < 6) {
      return NextResponse.json(
        { ok: false, error: "Password must be at least 6 characters." },
        { status: 400 }
      );
    }

    const email = customerEmailFromPhone(normalizedPhone);
    const supabase = createServiceSupabase();

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
            first_name: firstName,
            last_name: lastName,
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
            first_name: firstName,
            last_name: lastName,
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

    const { error: customerError } = await supabase.from("customers").upsert(
      {
        auth_user_id: authUserId,
        first_name: firstName,
        last_name: lastName,
        phone: normalizedPhone,
        normalized_phone: normalizedPhone,
        status: "active",
      },
      {
        onConflict: "auth_user_id",
      }
    );

    if (customerError) {
      return NextResponse.json(
        { ok: false, error: customerError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}