import { NextResponse } from "next/server";
import { normalizePhoneZA } from "@/lib/customer/auth";
import { createServiceSupabase } from "@/lib/customer/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const normalizedPhone = normalizePhoneZA(body?.phone);

    if (!normalizedPhone) {
      return NextResponse.json(
        { ok: false, error: "Valid cellphone number is required." },
        { status: 400 }
      );
    }

    const supabase = createServiceSupabase();

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
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error." },
      { status: 500 }
    );
  }
}
