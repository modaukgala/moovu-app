import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { chunkValues, collectBoundedPages } from "@/lib/admin/boundedRetrieval";

type ArchivedTripRow = {
  id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | null;
  payment_method: string | null;
  status: string | null;
  created_at: string | null;
  driver_id: string | null;
  commission_amount: number | null;
  driver_net_earnings: number | null;
};

type ArchivedTripWithDriver = ArchivedTripRow & {
  driver_name: string | null;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { searchParams } = new URL(req.url);

    const q = String(searchParams.get("q") ?? "").trim();
    const status = String(searchParams.get("status") ?? "").trim();
    const dateFrom = String(searchParams.get("dateFrom") ?? "").trim();
    const dateTo = String(searchParams.get("dateTo") ?? "").trim();
    const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(10, Number.parseInt(searchParams.get("pageSize") ?? "25", 10) || 25));

    const { supabaseAdmin } = auth;

    let matchingDriverIds: string[] = [];
    let driverCandidatesComplete = true;
    const safeTerm = q.replace(/[,%()]/g, " ");
    if (safeTerm) {
      const driverSearch = await collectBoundedPages<{ id: string }>({ pageSize: 500, maxRows: 10_000, load: async (from, to) => {
        const result = await supabaseAdmin.from("drivers").select("id")
          .or(`first_name.ilike.%${safeTerm}%,last_name.ilike.%${safeTerm}%`).order("id").range(from, to);
        if (result.error) throw new Error("Driver-name search is unavailable.");
        return result.data ?? [];
      }});
      matchingDriverIds = driverSearch.rows.map((row) => row.id);
      driverCandidatesComplete = driverSearch.complete;
    }

    let query = supabaseAdmin
      .from("trips")
      .select(`
        id,
        rider_name,
        rider_phone,
        pickup_address,
        dropoff_address,
        fare_amount,
        payment_method,
        status,
        created_at,
        driver_id,
        commission_amount,
        driver_net_earnings
      `, { count: "exact" });

    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    if (dateFrom) {
      query = query.gte("created_at", `${dateFrom}T00:00:00`);
    }

    if (dateTo) {
      query = query.lte("created_at", `${dateTo}T23:59:59`);
    }

    const start = (page - 1) * pageSize;
    let data: ArchivedTripRow[] = [];
    let count: number | null = 0;
    let resultsComplete = true;
    let totalLowerBound: number | null = null;
    let availablePages = 0;
    if (safeTerm) {
      const matched = new Map<string, ArchivedTripRow>();
      resultsComplete = driverCandidatesComplete;
      const textFilters = [`rider_name.ilike.%${safeTerm}%`, `rider_phone.ilike.%${safeTerm}%`, `pickup_address.ilike.%${safeTerm}%`, `dropoff_address.ilike.%${safeTerm}%`];
      if (/^[0-9a-f-]{36}$/i.test(safeTerm)) textFilters.push(`id.eq.${safeTerm}`);
      const filterGroups = [textFilters.join(","), ...chunkValues(matchingDriverIds, 100).map((ids) => `driver_id.in.(${ids.join(",")})`)];
      for (const filter of filterGroups) {
        const result = await collectBoundedPages<ArchivedTripRow>({ pageSize: 500, maxRows: 20_000, load: async (from, to) => {
          let matchedQuery = supabaseAdmin.from("trips").select(`id,rider_name,rider_phone,pickup_address,dropoff_address,fare_amount,payment_method,status,created_at,driver_id,commission_amount,driver_net_earnings`).or(filter);
          if (status && status !== "all") matchedQuery = matchedQuery.eq("status", status);
          if (dateFrom) matchedQuery = matchedQuery.gte("created_at", `${dateFrom}T00:00:00`);
          if (dateTo) matchedQuery = matchedQuery.lte("created_at", `${dateTo}T23:59:59`);
          const response = await matchedQuery.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
          if (response.error) throw new Error("Archive search is unavailable.");
          return (response.data ?? []) as ArchivedTripRow[];
        }});
        resultsComplete &&= result.complete;
        for (const row of result.rows) matched.set(row.id, row);
      }
      const allMatches = [...matched.values()].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")) || b.id.localeCompare(a.id));
      count = resultsComplete ? allMatches.length : null;
      totalLowerBound = resultsComplete ? null : allMatches.length;
      availablePages = Math.ceil(allMatches.length / pageSize);
      data = allMatches.slice(start, start + pageSize);
    } else {
      const response = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(start, start + pageSize - 1);
      if (response.error) return NextResponse.json({ ok: false, error: response.error.message }, { status: 500 });
      data = (response.data ?? []) as ArchivedTripRow[];
      count = response.count ?? 0;
      availablePages = Math.ceil(count / pageSize);
    }

    const rawTrips = data;
    const driverIds = Array.from(
      new Set(rawTrips.map((trip) => String(trip.driver_id ?? "").trim()).filter(Boolean)),
    );
    const driverNameById = new Map<string, string>();

    if (driverIds.length > 0) {
      const { data: driverRows, error: driverError } = await supabaseAdmin
        .from("drivers")
        .select("id,first_name,last_name")
        .in("id", driverIds);

      if (driverError) {
        console.error("[admin-archive] failed to resolve driver names", driverError);
      } else {
        for (const driver of driverRows ?? []) {
          const name = `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim();
          driverNameById.set(String(driver.id), name || "Driver profile unavailable");
        }
      }
    }

    const trips: ArchivedTripWithDriver[] = rawTrips.map((trip) => ({
      ...trip,
      driver_name: trip.driver_id
        ? driverNameById.get(trip.driver_id) ?? "Driver profile unavailable"
        : null,
    }));

    return NextResponse.json({
      ok: true,
      trips,
      page,
      pageSize,
      total: count,
      totalLowerBound,
      totalPages: resultsComplete ? Math.ceil((count ?? 0) / pageSize) : null,
      availablePages,
      resultsComplete,
      retrievalWarning: resultsComplete ? null : "Archive search reached its safe retrieval boundary. Results and counts are incomplete; refine the search.",
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(e, "Server error.") },
      { status: 500 }
    );
  }
}
