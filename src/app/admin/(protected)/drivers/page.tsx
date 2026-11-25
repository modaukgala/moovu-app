"use client";

import Link from "next/link";
import { AdminFilters, AdminPagination, AdminTableRegion } from "@/components/admin/AdminResults";
import { useCallback, useEffect, useRef, useState } from "react";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import MetricCard from "@/components/ui/MetricCard";
import StatusBadge from "@/components/ui/StatusBadge";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import { supabaseClient } from "@/lib/supabase/client";
import { useSearchParams } from "next/navigation";

type Driver = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  application_summary?: {
    id: string;
    cycle: number | null;
    status: string;
    decision: string | null;
    decisionAt: string | null;
    source: "phase6" | "legacy";
  } | null;
};

function driverName(driver: Driver) {
  return `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() || "Unnamed driver";
}

function isSuspendedDriver(status?: string | null) {
  return status === "inactive" || status === "suspended";
}

function adminDriverStatusLabel(status?: string | null) {
  return isSuspendedDriver(status) ? "suspended" : status;
}

export default function DriversPage() {
  const searchParams = useSearchParams();
  const onlineOnly = searchParams.get("online") === "true";
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const sequence = useRef(0);
  const [query, setQuery] = useState("");
  const [pageError, setPageError] = useState<string | null>(null);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();
    return session?.access_token ?? null;
  }, []);

  const invalidateRequest = useCallback(() => { ++sequence.current; }, []);

  const loadDrivers = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setPageError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Please sign in as an admin to view drivers.");
      const params = new URLSearchParams({ online: String(onlineOnly), q: query, status: statusFilter, page: String(page) });
      const res = await fetch(`/api/admin/drivers/list?${params}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok || !json?.ok || !Array.isArray(json.drivers) || !json.pagination) {
        throw new Error(json?.error || "Could not load drivers.");
      }
      if (request !== sequence.current) return;
      setDrivers(json.drivers);
      setTotal(json.pagination.total);
    } catch (error) {
      if (request !== sequence.current) return;
      setDrivers([]);
      setTotal(null);
      setPageError(error instanceof Error ? error.message : "Could not load drivers.");
    } finally {
      window.clearTimeout(timeout);
      if (request === sequence.current) setLoading(false);
    }
  }, [getAccessToken, onlineOnly, page, query, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDrivers(), 250);
    return () => {
      window.clearTimeout(timer);
      invalidateRequest();
    };
  }, [invalidateRequest, loadDrivers]);

  async function updateStatus(id: string, status: string) {
    setPageError(null);
    const token = await getAccessToken();
    if (!token) {
      setPageError("Please sign in as an admin to update drivers.");
      return;
    }

    const res = await fetch("/api/admin/drivers/status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ driverId: id, status }),
    });
    const json = await res.json().catch(() => null);

    if (!res.ok || !json?.ok) {
      setPageError(json?.error || "Could not update driver status. Please try again.");
      return;
    }

    await loadDrivers();
  }

  const approvedCount = drivers.filter((driver) =>
    ["active", "approved"].includes(driver.status ?? ""),
  ).length;
  const pendingCount = drivers.filter((driver) => driver.status === "pending").length;
  const suspendedCount = drivers.filter((driver) => isSuspendedDriver(driver.status)).length;

  return (
    <main className="space-y-6 text-black">
      {pageError && (
        <CenteredMessageBox
          title="Driver directory error"
          message={pageError}
          onClose={() => setPageError(null)}
        />
      )}

      <div className="moovu-card p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="moovu-section-title">Admin control center</div>
            <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">Drivers</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Review driver profiles, approval status, and operational access from one place.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={loadDrivers} className="moovu-btn moovu-btn-secondary">
              Refresh
            </button>
            <Link href="/admin/link-driver" className="moovu-btn moovu-btn-secondary">Link driver account</Link>
            <Link href="/admin/drivers/new" className="moovu-btn moovu-btn-primary">
              Add driver
            </Link>
          </div>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Matching drivers" value={total === null ? "Unavailable" : String(total)} helper="Current filters" />
        <MetricCard
          label="Approved"
          value={String(approvedCount)}
          helper="Approved on this page"
          tone="success"
        />
        <MetricCard
          label="Needs review"
          value={String(pendingCount + suspendedCount)}
          helper="Pending or suspended on this page"
          tone={pendingCount + suspendedCount > 0 ? "warning" : "default"}
        />
      </section>

      <AdminFilters label="Driver filters">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
          <label className="grid gap-1 text-sm font-semibold">Search drivers
          <input
            value={query}
            onChange={(event) => { setPage(1); setQuery(event.target.value); }}
            aria-label="Search drivers by name, phone or email"
            placeholder="Search driver, phone, or email"
            className="min-h-11 rounded-2xl border border-[var(--moovu-border)] bg-white px-4 text-sm font-semibold text-slate-950 outline-none focus:border-[var(--moovu-blue)]"
          /></label>
          <div className="flex flex-wrap gap-2">
            {["all", "pending", "approved", "active", "suspended"].map((status) => (
              <button
                key={status}
                onClick={() => { setPage(1); setStatusFilter(status); }}
                className={`rounded-xl border px-4 py-2 text-sm font-black capitalize transition ${
                  statusFilter === status
                    ? "border-[var(--moovu-blue)] bg-[var(--moovu-blue)] text-white"
                    : "border-[var(--moovu-border)] bg-white text-slate-700"
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      </AdminFilters>

      <section className="moovu-card overflow-hidden">
        <AdminPagination label="matching drivers" page={page} count={total} busy={loading}
          hasNext={total === null ? drivers.length === 50 : page * 50 < total} onPage={setPage} />
        {loading ? <LoadingState title="Loading drivers" description="Preparing driver profiles." /> : pageError && drivers.length === 0 ? (
          <button onClick={() => void loadDrivers()}>Retry driver directory</button>
        ) : drivers.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No drivers found"
              description="Adjust your search or status filter to find driver profiles."
            />
          </div>
        ) : (
          <>
            <AdminTableRegion className="hidden lg:block" label="Driver results table">
              <table className="w-full min-w-[840px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-5 py-4">Driver</th>
                    <th className="px-5 py-4">Phone</th>
                    <th className="px-5 py-4">Email</th>
                    <th className="px-5 py-4">Status</th>
                    <th className="px-5 py-4">Application</th>
                    <th className="px-5 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {drivers.map((driver) => (
                    <tr key={driver.id} className="border-t border-[var(--moovu-border)]">
                      <td className="px-5 py-4 font-black text-slate-950">
                        <Link href={`/admin/drivers/${driver.id}`} className="hover:text-[var(--moovu-blue)]">
                          {driverName(driver)}
                        </Link>
                      </td>
                      <td className="px-5 py-4 text-slate-700">{driver.phone ?? "--"}</td>
                      <td className="px-5 py-4 text-slate-700">{driver.email ?? "--"}</td>
                      <td className="px-5 py-4">
                        <StatusBadge status={adminDriverStatusLabel(driver.status)} />
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-700">
                        {driver.application_summary ? (
                          <Link href={driver.application_summary.source === "phase6" ? `/admin/onboarding?id=${driver.application_summary.id}` : `/admin/drivers/${driver.id}`} className="font-bold hover:underline">
                            {driver.application_summary.status} · {driver.application_summary.decision ?? "No decision"}
                          </Link>
                        ) : "Unavailable"}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-2">
                          {driver.status === "pending" && (
                            <button
                              onClick={() => void updateStatus(driver.id, "approved")}
                              className="moovu-btn moovu-btn-secondary"
                            >
                              Approve
                            </button>
                          )}
                          {!isSuspendedDriver(driver.status) && (
                            <button
                              onClick={() => void updateStatus(driver.id, "inactive")}
                              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-black text-red-700"
                            >
                              Suspend
                            </button>
                          )}
                          {isSuspendedDriver(driver.status) && (
                            <button
                              onClick={() => void updateStatus(driver.id, "active")}
                              className="moovu-btn moovu-btn-primary"
                            >
                              Activate
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableRegion>

            <div className="grid gap-3 p-4 lg:hidden">
              {drivers.map((driver) => (
                <article key={driver.id} className="rounded-2xl border border-[var(--moovu-border)] bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        href={`/admin/drivers/${driver.id}`}
                        className="text-lg font-black text-slate-950"
                      >
                        {driverName(driver)}
                      </Link>
                      <div className="mt-2">
                        <StatusBadge status={adminDriverStatusLabel(driver.status)} />
                      </div>
                      <div className="mt-2 text-xs font-bold text-slate-600">
                        Application: {driver.application_summary?.status ?? "Unavailable"} · {driver.application_summary?.decision ?? "No decision"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 text-sm text-slate-700">
                    <div>{driver.phone ?? "--"}</div>
                    <div>{driver.email ?? "--"}</div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {driver.status === "pending" && (
                      <button
                        onClick={() => void updateStatus(driver.id, "approved")}
                        className="moovu-btn moovu-btn-secondary"
                      >
                        Approve
                      </button>
                    )}
                    {!isSuspendedDriver(driver.status) && (
                      <button
                        onClick={() => void updateStatus(driver.id, "inactive")}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-black text-red-700"
                      >
                        Suspend
                      </button>
                    )}
                    {isSuspendedDriver(driver.status) && (
                      <button
                        onClick={() => void updateStatus(driver.id, "active")}
                        className="moovu-btn moovu-btn-primary"
                      >
                        Activate
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
