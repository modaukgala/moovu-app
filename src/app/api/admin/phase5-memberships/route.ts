import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { collectBoundedPages, chunkValues } from "@/lib/admin/boundedRetrieval";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: "Financial Admin required." }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const page = Number(params.get("page") ?? 1);
  const status = params.get("status") ?? "all";
  const pageSize = 25;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !["all", "SUBMITTED", "APPROVED", "REJECTED"].includes(status)) {
    return NextResponse.json({ ok: false, error: "Invalid payment history filters." }, { status: 400 });
  }
  const db = auth.supabaseAdmin;
  let query = db.from("phase5_membership_payments")
    .select("id,customer_id,amount_cents,currency,method,reference,status,submitted_at,reviewed_at,reviewed_by,review_reason,financial_transaction_id", { count: "exact" });
  if (status !== "all") query = query.eq("status", status);
  const { data, error, count } = await query.order("submitted_at", { ascending: false }).order("id", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error || !data || count == null) return NextResponse.json({ ok: false, error: "Membership reviews are unavailable." }, { status: 503 });
  const now = new Date().toISOString();
  const [membership, receipts, ...counts] = await Promise.all([
    collectBoundedPages<{ customer_id: string; status: string; starts_at: string; expires_at: string }>({
      pageSize: 500, maxRows: 10000, load: async (from, to) => {
        const result = await db.from("phase5_memberships").select("customer_id,status,starts_at,expires_at").order("id").range(from, to);
        if (result.error || !result.data) throw new Error("Memberships unavailable.");
        return result.data;
      },
    }).catch(() => null),
    (async () => {
      const approved = await collectBoundedPages<{ financial_transaction_id: string; amount_cents: number }>({
        pageSize: 500, maxRows: 10000, load: async (from, to) => {
          const result = await db.from("phase5_membership_payments").select("financial_transaction_id,amount_cents")
            .eq("status", "APPROVED").not("financial_transaction_id", "is", null).order("id").range(from, to);
          if (result.error || !result.data) throw new Error("Receipts unavailable.");
          return result.data;
        },
      });
      if (!approved.complete) return null;
      const unique = new Map(approved.rows.map((row) => [row.financial_transaction_id, row.amount_cents]));
      const posted = new Set<string>();
      for (const ids of chunkValues([...unique.keys()], 100)) {
        const result = await db.from("financial_transactions").select("id").eq("transaction_state", "POSTED").in("id", ids);
        if (result.error || !result.data) throw new Error("Financial evidence unavailable.");
        for (const row of result.data) posted.add(row.id);
      }
      const amounts = [...posted].map((id) => unique.get(id));
      if (amounts.some((amount) => !Number.isSafeInteger(amount))) return null;
      return { posted, cents: amounts.reduce<number>((sum, amount) => sum + amount!, 0), complete: posted.size === unique.size };
    })().catch(() => null),
    ...["SUBMITTED", "APPROVED", "REJECTED"].map(async (state) => {
      const result = await db.from("phase5_membership_payments").select("id", { head: true, count: "exact" }).eq("status", state);
      return result.error ? null : result.count;
    }),
  ]);
  const active = new Set<string>();
  const expired = new Set<string>();
  const inactive = new Set<string>();
  for (const row of membership?.rows ?? []) {
    if (row.status === "ACTIVE" && row.starts_at <= now && row.expires_at > now) active.add(row.customer_id);
    else if (row.status === "ACTIVE" && row.expires_at <= now || row.status === "EXPIRED") expired.add(row.customer_id);
    else inactive.add(row.customer_id);
  }
  for (const id of active) { expired.delete(id); inactive.delete(id); }
  for (const id of expired) inactive.delete(id);
  const membershipComplete = membership?.complete === true;
  return NextResponse.json({
    ok: true, page, pageSize, total: count, counts,
    payments: data.map((row) => ({ ...row,
      evidence: row.status === "APPROVED" ? receipts?.posted.has(row.financial_transaction_id) ? "Posted" : "Unavailable" : "Not approved",
      membership: !membershipComplete ? "Unavailable" : active.has(row.customer_id) ? "Active" : expired.has(row.customer_id) ? "Expired"
        : inactive.has(row.customer_id) ? "Inactive" : "No membership recorded",
    })),
    membershipCounts: membershipComplete ? { active: active.size, expired: expired.size, inactive: inactive.size } : null,
    receiptCents: receipts?.cents ?? null, receiptComplete: receipts?.complete ?? false,
  });
}

export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: "Financial Admin required." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const paymentId = String(body?.paymentId ?? "").trim();
  const reason = String(body?.reason ?? "").trim();
  const action = String(body?.action ?? "approve").trim();
  if (!uuid.test(paymentId) || reason.length < 3 || reason.length > 500) {
    return NextResponse.json({ ok: false, error: "Payment and an approval reason are required." }, { status: 400 });
  }
  if (!['approve','reject'].includes(action)) return NextResponse.json({ ok: false, error: "Unsupported review action." }, { status: 400 });
  const { data, error } = await auth.supabaseAdmin.rpc(action === 'approve' ? "phase5_approve_membership_payment" : "phase5_reject_membership_payment", {
    p_payment_id: paymentId, p_actor_id: auth.user.id, p_reason: reason,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
  return NextResponse.json({ ok: true, result: data });
}
