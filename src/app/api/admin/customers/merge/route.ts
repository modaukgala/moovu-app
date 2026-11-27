import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { adminDeleteCustomer } from "@/lib/account-deletion/service";

const ACTIVE = ["requested", "offered", "assigned", "arrived", "ongoing"];
// Records that may not be moved automatically (money, memberships, debts).
const LOCKED_TABLES = [
  "online_payment_attempts", "phase4_fee_assessments", "phase4_customer_liabilities", "phase4_customer_grace_cycles",
  "phase4b_cancellation_quotes", "phase5_membership_payments", "phase5_memberships", "phase5_credit_issuances",
  "phase5_credit_redemptions",
];
// Records that simply follow the customer.
const MOVABLE_TABLES = ["trip_ratings", "trip_issues", "trip_shares", "trip_cancellation_fees", "trip_audio_recordings"];

/**
 * Merge a duplicate customer into the one to keep: trips and history move across,
 * then the duplicate account is removed. Body: { keepId, removeId }
 */
export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) {
    return NextResponse.json({ ok: false, error: "Only the owner or an admin can merge customers." }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const keepId = String(body?.keepId ?? "");
  const removeId = String(body?.removeId ?? "");
  if (!keepId || !removeId || keepId === removeId) {
    return NextResponse.json({ ok: false, error: "Choose two different customers." }, { status: 400 });
  }
  const db = auth.supabaseAdmin;
  const { data: pair, error } = await db.from("customers").select("id,auth_user_id,first_name,last_name").in("id", [keepId, removeId]);
  if (error) return NextResponse.json({ ok: false, error: "Customers are unavailable." }, { status: 503 });
  const keep = pair?.find(c => c.id === keepId);
  const remove = pair?.find(c => c.id === removeId);
  if (!keep || !remove) return NextResponse.json({ ok: false, error: "One of the customers no longer exists." }, { status: 404 });

  const active = await db.from("trips").select("id", { count: "exact", head: true }).eq("customer_id", removeId).in("status", ACTIVE);
  if ((active.count ?? 0) > 0) {
    return NextResponse.json({ ok: false, error: "The account you're removing has a ride in progress. Try again when it ends." }, { status: 409 });
  }
  for (const table of LOCKED_TABLES) {
    const column = "customer_id";
    const res = await db.from(table).select("id", { count: "exact", head: true }).eq(column, removeId);
    if (!res.error && (res.count ?? 0) > 0) {
      return NextResponse.json({ ok: false, error: "The account you're removing has card payments or membership records, so it can't be merged automatically. Keep that one instead, and remove the other." }, { status: 409 });
    }
  }

  const moved = await db.from("trips").update({ customer_id: keepId, customer_auth_user_id: keep.auth_user_id })
    .eq("customer_id", removeId).select("id");
  if (moved.error) {
    console.error("[admin-customer-merge] trip move failed", { code: moved.error.code });
    return NextResponse.json({ ok: false, error: "Couldn't move the trips. Nothing was removed." }, { status: 503 });
  }
  for (const table of MOVABLE_TABLES) {
    const res = await db.from(table).update({ customer_id: keepId }).eq("customer_id", removeId);
    if (res.error && res.error.code !== "PGRST205" && res.error.code !== "42703") {
      console.error("[admin-customer-merge] move failed", { table, code: res.error.code });
    }
  }
  const removed = await adminDeleteCustomer({ supabase: db, customerId: removeId, reason: `Merged into ${keepId}` });
  if (!removed.ok) {
    return NextResponse.json({ ok: false, error: `Trips were moved, but the duplicate couldn't be removed: ${removed.error}` }, { status: removed.status });
  }
  return NextResponse.json({ ok: true, movedTrips: moved.data?.length ?? 0 }, { headers: { "Cache-Control": "private, no-store" } });
}
