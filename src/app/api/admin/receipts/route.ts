import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { chunkValues, collectBoundedPages } from "@/lib/admin/boundedRetrieval";

type ReceiptRow = { id: string; driver_id: string | null; rider_name: string | null; rider_phone: string | null; pickup_address: string | null; dropoff_address: string | null; fare_amount: number | null; payment_method: string | null; status: string; created_at: string; completed_at: string | null; cancelled_at: string | null };
const RECEIPT_SELECT = "id,driver_id,rider_name,rider_phone,pickup_address,dropoff_address,fare_amount,payment_method,status,created_at,completed_at,cancelled_at";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const url = new URL(req.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25));
    const q = String(url.searchParams.get("q") ?? "").trim().replace(/[,%()]/g, " ");
    let driverIds: string[] = [];
    let driverCandidatesComplete = true;
    if (q) {
      const driverResult = await collectBoundedPages<{ id: string }>({ pageSize: 500, maxRows: 10_000, load: async (from, to) => {
        const result = await auth.supabaseAdmin.from("drivers").select("id")
          .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`).order("id").range(from, to);
        if (result.error) throw new Error("Receipt driver search is unavailable.");
        return result.data ?? [];
      }});
      driverIds = driverResult.rows.map((row) => row.id);
      driverCandidatesComplete = driverResult.complete;
    }
    if (q) {
      const matched = new Map<string, ReceiptRow>();
      let matchesComplete = driverCandidatesComplete;
      const textFilters = [`rider_name.ilike.%${q}%`, `rider_phone.ilike.%${q}%`, `pickup_address.ilike.%${q}%`, `dropoff_address.ilike.%${q}%`];
      if (/^[0-9a-f-]{36}$/i.test(q)) textFilters.push(`id.eq.${q}`);
      const filterGroups = [textFilters.join(","), ...chunkValues(driverIds, 100).map((ids) => `driver_id.in.(${ids.join(",")})`)];
      for (const filter of filterGroups) {
        if (!filter) continue;
        const result = await collectBoundedPages<ReceiptRow>({ pageSize: 500, maxRows: 20_000, load: async (from, to) => {
          const query = auth.supabaseAdmin.from("trips").select(RECEIPT_SELECT)
            .in("status", ["completed"])
            .or(filter).order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
          const response = await query;
          if (response.error) throw new Error("Receipt search is unavailable.");
          return (response.data ?? []) as ReceiptRow[];
        }});
        matchesComplete &&= result.complete;
        for (const row of result.rows) matched.set(row.id, row);
      }
      const rows = [...matched.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      const totalPages = Math.ceil(rows.length / pageSize);
      return NextResponse.json({
        ok: true, receipts: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize,
        total: matchesComplete ? rows.length : null, totalLowerBound: matchesComplete ? null : rows.length,
        totalPages: matchesComplete ? totalPages : null, availablePages: totalPages,
        resultsComplete: matchesComplete,
        retrievalWarning: matchesComplete ? null : "Receipt search reached its safe retrieval boundary. Results and counts are incomplete; refine the search.",
      });
    }
    const query = auth.supabaseAdmin.from("trips")
      .select(RECEIPT_SELECT, { count: "exact" })
      .in("status", ["completed"]);
    const start = (page - 1) * pageSize;
    const { data, error, count } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(start, start + pageSize - 1);
    if (error) {
      console.error("[admin-receipts] failed to load receipts", error);
      return NextResponse.json({ ok: false, error: "Could not load receipts. Please refresh or contact admin support." }, { status: 500 });
    }
    const total = count ?? 0;
    return NextResponse.json({ ok: true, receipts: data ?? [], page, pageSize, total, totalPages: Math.ceil(total / pageSize), resultsComplete: true, retrievalWarning: null });
  } catch (error: unknown) {
    console.error("[admin-receipts] unexpected error", errorMessage(error, "Unknown error"));
    return NextResponse.json(
      { ok: false, error: "Could not load receipts. Please refresh or contact admin support." },
      { status: 500 }
    );
  }
}
