import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { collectBoundedPages } from "@/lib/admin/boundedRetrieval";
import { earningsPeriod, recordedSum, reportingDay } from "@/lib/admin/earningsMetrics";

export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: "Financial Admin access required." }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const today = reportingDay(new Date());
  if (!params.has("from")) params.set("from", today.slice(0, 7) + "-01");
  if (!params.has("to")) params.set("to", today);
  let period;
  try { period = earningsPeriod(params); }
  catch { return NextResponse.json({ ok: false, error: "Invalid reporting period." }, { status: 400 }); }
  const { start, end } = period;
  const page = Number(params.get("page") ?? 1);
  const pageSize = 25;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return NextResponse.json({ ok: false, error: "Invalid receipt page." }, { status: 400 });
  try {
    const history = await auth.supabaseAdmin.from("driver_subscription_payments")
      .select("id,driver_id,amount_paid,created_at,reference,payment_method,payment_request_id", { count: "exact" })
      .gte("created_at", start).lt("created_at", end).order("created_at", { ascending: false })
      .order("id", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    if (history.error || !history.data || history.count == null) throw new Error("Recorded subscription receipts unavailable.");
    const ids = [...new Set(history.data.flatMap((row) => row.payment_request_id ? [row.payment_request_id] : []))];
    const proofs = ids.length ? await auth.supabaseAdmin.from("driver_payment_requests").select("id,payment_type").in("id", ids) : { data: [] };
    const types = new Map((proofs.data ?? []).map((row) => [row.id, row.payment_type]));
    const receipts = await collectBoundedPages<{ id: string; amount_paid: number | null }>({
      pageSize: 500, maxRows: 10000,
      load: async (from, to) => {
        const result = await auth.supabaseAdmin.from("driver_subscription_payments").select("id,amount_paid")
          .gte("created_at", start).lt("created_at", end).order("id").range(from, to);
        if (result.error || !result.data) throw new Error("Recorded subscription receipts unavailable.");
        return result.data;
      },
    }).catch(() => null);
    const unique = new Map((receipts?.rows ?? []).map((row) => [row.id, row.amount_paid]));
    return NextResponse.json({ ok: true, period, complete: receipts?.complete ?? null,
      total: receipts?.complete ? recordedSum([...unique.values()]) : null,
      page, pageSize, count: history.count, rows: history.data.map((row) => ({ ...row, proof_type: types.get(row.payment_request_id) ?? null })) });
  } catch {
    return NextResponse.json({ ok: false, error: "Recorded subscription receipts unavailable." }, { status: 503 });
  }
}
