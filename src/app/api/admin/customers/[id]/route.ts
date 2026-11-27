import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { adminDeleteCustomer } from "@/lib/account-deletion/service";
import { normalizePhoneZA } from "@/lib/customer/auth";

const NO_STORE = { "Cache-Control": "private, no-store" };
const clean = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

async function ownerOrAdmin(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return { ok: false as const, res: NextResponse.json({ ok: false, error: auth.error }, { status: auth.status }) };
  if (!isFinancialAdminRole(auth.profile.role)) {
    return { ok: false as const, res: NextResponse.json({ ok: false, error: "Only the owner or an admin can change customers." }, { status: 403 }) };
  }
  return { ok: true as const, auth };
}

/** Edit a customer's name, phone, email or status. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await ownerOrAdmin(req);
  if (!gate.ok) return gate.res;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const firstName = clean(body?.firstName, 60);
  const lastName = clean(body?.lastName, 60);
  const email = clean(body?.email, 120).toLowerCase();
  const phone = normalizePhoneZA(clean(body?.phone, 20));
  const status = body?.status === "blocked" ? "blocked" : "active";
  if (!firstName || !lastName) return NextResponse.json({ ok: false, error: "First name and surname are required." }, { status: 400 });
  if (!phone || !/^0\d{9}$/.test(phone)) return NextResponse.json({ ok: false, error: "Enter a valid South African phone number (e.g. 0821234567)." }, { status: 400 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ ok: false, error: "That email address doesn't look right." }, { status: 400 });

  const db = gate.auth.supabaseAdmin;
  const clash = await db.from("customers").select("id,first_name,last_name")
    .or(`normalized_phone.eq.${phone}${email ? `,email.ilike.${email}` : ""}`).neq("id", id).limit(1).maybeSingle();
  if (clash.data) {
    return NextResponse.json({ ok: false, error: `Another customer (${clash.data.first_name ?? ""} ${clash.data.last_name ?? ""}) already uses that phone or email. Merge them instead.` }, { status: 409 });
  }
  const { data, error } = await db.from("customers").update({
    first_name: firstName, last_name: lastName, phone, normalized_phone: phone, email: email || null, status,
  }).eq("id", id).select("id,first_name,last_name,phone,email,status").maybeSingle();
  if (error) {
    console.error("[admin-customer-edit] update failed", { code: error.code });
    return NextResponse.json({ ok: false, error: "Couldn't save the changes. Please try again." }, { status: 503 });
  }
  if (!data) return NextResponse.json({ ok: false, error: "Customer not found." }, { status: 404 });
  return NextResponse.json({ ok: true, customer: data }, { headers: NO_STORE });
}

/** Remove a customer. Their trip history is kept but anonymised. Body: { confirm: "DELETE" } */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await ownerOrAdmin(req);
  if (!gate.ok) return gate.res;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (body?.confirm !== "DELETE") return NextResponse.json({ ok: false, error: "Type DELETE to confirm." }, { status: 400 });
  const result = await adminDeleteCustomer({ supabase: gate.auth.supabaseAdmin, customerId: id, reason: "Removed by admin" });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
