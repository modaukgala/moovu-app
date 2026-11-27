import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizePhoneZA } from "@/lib/customer/auth";
import { checkResetCode, type StoredResetCode } from "@/lib/auth/resetCodePolicy";
import { takeRateLimit } from "@/lib/server/requestControl";

const WRONG = "That code didn't work. Check the phone number or email and the code, or ask MOOVU on WhatsApp for a new one.";

async function findUserId(identifier: string) {
  const raw = identifier.trim().toLowerCase();
  if (raw.includes("@")) {
    const [{ data: customer }, { data: driver }] = await Promise.all([
      supabaseAdmin.from("customers").select("auth_user_id").ilike("email", raw).not("auth_user_id", "is", null).limit(1).maybeSingle(),
      supabaseAdmin.from("drivers").select("id").ilike("email", raw).eq("is_deleted", false).limit(1).maybeSingle(),
    ]);
    if (customer?.auth_user_id) return customer.auth_user_id as string;
    if (!driver?.id) return null;
    const { data: account } = await supabaseAdmin.from("driver_accounts").select("user_id").eq("driver_id", driver.id).maybeSingle();
    return (account?.user_id as string | undefined) ?? null;
  }
  const phone = normalizePhoneZA(raw);
  if (!phone) return null;
  const { data: customer } = await supabaseAdmin.from("customers").select("auth_user_id")
    .eq("normalized_phone", phone).not("auth_user_id", "is", null).limit(1).maybeSingle();
  if (customer?.auth_user_id) return customer.auth_user_id as string;
  const { data: drivers } = await supabaseAdmin.from("drivers").select("id,phone").eq("is_deleted", false).limit(1000);
  const driver = (drivers ?? []).find((row) => normalizePhoneZA(String(row.phone ?? "")) === phone);
  if (!driver) return null;
  const { data: account } = await supabaseAdmin.from("driver_accounts").select("user_id").eq("driver_id", driver.id).maybeSingle();
  return (account?.user_id as string | undefined) ?? null;
}

/** Customer or driver sets a new password with the code MOOVU sent them on WhatsApp. */
export async function POST(req: Request) {
  const limit = takeRateLimit(req, "reset-with-code", { limit: 8, windowMs: 15 * 60 * 1000 });
  if (!limit.ok) return NextResponse.json({ ok: false, error: "Too many tries. Wait 15 minutes and try again." }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { identifier?: string; code?: string; password?: string } | null;
  const code = String(body?.code ?? "").replace(/\D/g, "");
  const password = String(body?.password ?? "");
  if (code.length !== 6) return NextResponse.json({ ok: false, error: "Enter the 6-digit code." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ ok: false, error: "Use at least 8 characters for your new password." }, { status: 400 });

  const userId = await findUserId(String(body?.identifier ?? ""));
  if (!userId) return NextResponse.json({ ok: false, error: WRONG }, { status: 400 });
  const { data: found } = await supabaseAdmin.auth.admin.getUserById(userId);
  const user = found.user;
  if (!user) return NextResponse.json({ ok: false, error: WRONG }, { status: 400 });
  const stored = (user.app_metadata?.moovu_reset ?? null) as StoredResetCode | null;
  const result = checkResetCode(userId, code, stored);

  if (result !== "ok") {
    if (result === "wrong" && stored) {
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        app_metadata: { ...user.app_metadata, moovu_reset: { ...stored, tries: (stored.tries ?? 0) + 1 } },
      });
    }
    const error = result === "expired" ? "That code has expired. Ask MOOVU on WhatsApp for a new one."
      : result === "locked" ? "Too many wrong tries on this code. Ask MOOVU on WhatsApp for a new one." : WRONG;
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }

  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password,
    app_metadata: { ...user.app_metadata, moovu_reset: null },
  });
  if (error) return NextResponse.json({ ok: false, error: "Could not save the new password. Try a different one." }, { status: 400 });
  console.info("[reset-code] password reset", { userId });
  const loginEmail = user.email ?? null;
  return NextResponse.json({ ok: true, loginEmail });
}
