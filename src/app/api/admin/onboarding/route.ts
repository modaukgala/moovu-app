import { NextResponse } from "next/server";
import { phase6Auth } from "@/lib/drivers/phase6Server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { boundedCount, collectBoundedPages } from "@/lib/admin/boundedRetrieval";

type QueueApplication = { id: string; driver_id: string; status: string; cycle: number; version: number; revision: number; created_at: string; updated_at: string };

const QUEUE_SELECT = "id,driver_id,status,cycle,version,revision,created_at,updated_at";

function safeSearchTerm(value: string) {
  return value.trim().replace(/[,%()]/g, " ").slice(0, 120);
}
export async function GET(req: Request) {
  const user = await phase6Auth(req, true);
  if (!user) return NextResponse.json({ error: "Reviewer access required." }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25));
    const status = String(url.searchParams.get("status") ?? "").trim().toUpperCase();
    const search = String(url.searchParams.get("q") ?? "").trim();
    let query = supabaseAdmin
      .from("phase6_applications")
      .select(QUEUE_SELECT, { count: "exact" });
    if (status === "NEEDS_REVIEW") query = query.in("status", ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"]);
    else if (status && status !== "ALL") query = query.eq("status", status);
    if (search) {
      const term = safeSearchTerm(search);
      const driverCandidates = await collectBoundedPages<{ id: string }>({
        pageSize: 500, maxRows: 10_000,
        load: async (from, to) => {
          const result = await supabaseAdmin.from("drivers").select("id")
            .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`)
            .order("id").range(from, to);
          if (result.error) throw new Error("Applicant driver search is unavailable.");
          return result.data ?? [];
        },
      });
      const versionCandidates = await collectBoundedPages<{ application_id: string }>({
        pageSize: 500, maxRows: 10_000,
        load: async (from, to) => {
          const result = await supabaseAdmin.from("phase6_versions").select("application_id")
            .or(`snapshot->personal->>first_name.ilike.%${term}%,snapshot->personal->>last_name.ilike.%${term}%,snapshot->personal->>phone.ilike.%${term}%`)
            .order("application_id").range(from, to);
          if (result.error) throw new Error("Submitted application search is unavailable.");
          return result.data ?? [];
        },
      });
      const driverIds = [...new Set(driverCandidates.rows.map((row) => row.id))];
      const applicationIds = [...new Set(versionCandidates.rows.map((row) => row.application_id))];
      const matched = new Map<string, QueueApplication>();
      let applicationMatchesComplete = true;
      const uuidSearch = /^[0-9a-f-]{36}$/i.test(search) ? search : null;
      for (let offset = 0; offset < Math.max(driverIds.length, applicationIds.length, uuidSearch ? 1 : 0); offset += 100) {
        const filters: string[] = [];
        const driverChunk = driverIds.slice(offset, offset + 100);
        const applicationChunk = applicationIds.slice(offset, offset + 100);
        if (driverChunk.length) filters.push(`driver_id.in.(${driverChunk.join(",")})`);
        if (applicationChunk.length) filters.push(`id.in.(${applicationChunk.join(",")})`);
        if (offset === 0 && uuidSearch) filters.push(`id.eq.${uuidSearch}`, `driver_id.eq.${uuidSearch}`);
        if (!filters.length) continue;
        const pageResult = await collectBoundedPages<QueueApplication>({
          pageSize: 500, maxRows: 10_000,
          load: async (from, to) => {
            let matchedQuery = supabaseAdmin.from("phase6_applications").select(QUEUE_SELECT).or(filters.join(","));
            if (status === "NEEDS_REVIEW") matchedQuery = matchedQuery.in("status", ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"]);
            else if (status && status !== "ALL") matchedQuery = matchedQuery.eq("status", status);
            const result = await matchedQuery.order("updated_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
            if (result.error) throw new Error("Review queue search unavailable.");
            return (result.data ?? []) as QueueApplication[];
          },
        });
        applicationMatchesComplete &&= pageResult.complete;
        for (const row of pageResult.rows) matched.set(row.id, row);
      }
      const rows = [...matched.values()].sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")) || b.id.localeCompare(a.id));
      const complete = driverCandidates.complete && versionCandidates.complete && applicationMatchesComplete;
      const count = boundedCount(rows.length, complete);
      return NextResponse.json({
        applications: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize,
        total: count.total, totalLowerBound: complete ? null : rows.length,
        totalPages: complete ? Math.ceil(rows.length / pageSize) : null,
        availablePages: Math.ceil(rows.length / pageSize),
        resultsComplete: complete,
        retrievalWarning: complete ? null : "Applicant search reached its safe retrieval boundary. Results and counts are incomplete; refine the search.",
        searchFields: ["application_id", "driver_id", "driver_name", "cellphone", "email", "submitted_name", "submitted_cellphone"],
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const start = (page - 1) * pageSize;
    const result = await query.order("updated_at", { ascending: false }).order("id", { ascending: false }).range(start, start + pageSize - 1);
    if (result.error) return NextResponse.json({ error: "Review queue unavailable." }, { status: 503 });
    const total = result.count ?? 0;
    return NextResponse.json({ applications: result.data ?? [], page, pageSize, total, totalPages: Math.ceil(total / pageSize), resultsComplete: true, retrievalWarning: null, searchFields: ["application_id", "driver_id", "driver_name", "cellphone", "email", "submitted_name", "submitted_cellphone"] }, { headers: { "Cache-Control": "no-store" } });
  }
  const [application, versions, reviews, uploads] = await Promise.all([
    supabaseAdmin.from("phase6_applications").select("*").eq("id", id).maybeSingle(),
    supabaseAdmin.from("phase6_versions").select("*").eq("application_id", id).order("version"),
    supabaseAdmin.from("phase6_reviews").select("*").eq("application_id", id).order("created_at"),
    supabaseAdmin.from("phase6_uploads").select("id,section,state,source,width,height,bytes,created_at").eq("application_id", id),
  ]);
  if (!application.data || application.error || versions.error || reviews.error || uploads.error) return NextResponse.json({ error: "Application unavailable." }, { status: 404 });
  return NextResponse.json({ application: application.data, versions: versions.data, reviews: reviews.data, uploads: uploads.data }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: Request) {
  const user = await phase6Auth(req, true);
  if (!user) return NextResponse.json({ error: "Reviewer access required." }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || !["UNDER_REVIEW", "APPROVED", "REJECTED", "CORRECTION_REQUESTED", "REAPPLICATION_AUTHORIZED", "REINSPECTION_AUTHORIZED"].includes(body.action) || !/^[0-9a-f-]{36}$/i.test(body.key ?? "") || !Number.isSafeInteger(body.revision) || typeof body.reason !== "string" || body.reason.trim().length < 8 || body.reason.length > 2000 || !Array.isArray(body.sections ?? [])) return NextResponse.json({ error: "Invalid decision." }, { status: 400 });
  if (body.action === "REINSPECTION_AUTHORIZED") {
    const { data, error } = await supabaseAdmin.rpc("phase6_reinspection", { p_actor: user.id, p_application: body.application, p_revision: body.revision, p_key: body.key, p_reason: body.reason });
    return NextResponse.json(error ? { error: "Reinspection authorization could not be recorded safely." } : { application: data }, { status: error ? 409 : 200, headers: { "Cache-Control": "no-store" } });
  }
  const { data, error } = await supabaseAdmin.rpc("phase6_command", { p_actor: user.id, p_key: body.key, p_action: body.action, p_application: body.application, p_revision: body.revision, p_payload: { reason: body.reason, sections: body.sections ?? [] } });
  if (error) return NextResponse.json({ error: error.code === "P0001" ? error.message : "Review could not be recorded safely." }, { status: error.code === "P0001" ? 409 : 503 });
  return NextResponse.json({ application: data }, { headers: { "Cache-Control": "no-store" } });
}
