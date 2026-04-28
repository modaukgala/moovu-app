"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import MetricCard from "@/components/ui/MetricCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { supabaseClient } from "@/lib/supabase/client";

type Driver = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
};

function driverName(driver: Driver) {
  return `${driver.first_name ?? ""} ${driver.last_name ?? ""}`.trim() || "Unnamed driver";
}

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");

  const loadDrivers = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabaseClient
      .from("drivers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setDrivers([]);
      setLoading(false);
      return;
    }

    setDrivers((data ?? []) as Driver[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDrivers();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadDrivers]);

  async function updateStatus(id: string, status: string) {
    await supabaseClient.from("drivers").update({ status }).eq("id", id);
    await loadDrivers();
  }

  const filteredDrivers = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    return drivers.filter((driver) => {
      const statusMatch = statusFilter === "all" || driver.status === statusFilter;
      const text = `${driverName(driver)} ${driver.phone ?? ""} ${driver.email ?? ""}`.toLowerCase();
      const queryMatch = !cleanQuery || text.includes(cleanQuery);
      return statusMatch && queryMatch;
    });
  }, [drivers, query, statusFilter]);

  const approvedCount = drivers.filter((driver) =>
    ["active", "approved"].includes(driver.status ?? ""),
  ).length;
  const pendingCount = drivers.filter((driver) => driver.status === "pending").length;
  const suspendedCount = drivers.filter((driver) => driver.status === "suspended").length;

  if (loading) {
    return (
      <LoadingState
        title="Loading drivers"
        description="Preparing driver profiles, approval states, and operation actions."
      />
    );
  }

  return (
    <main className="space-y-6 text-black">
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
            <Link href="/admin/drivers/new" className="moovu-btn moovu-btn-primary">
              Add driver
            </Link>
          </div>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Total drivers" value={String(drivers.length)} helper="All profiles" />
        <MetricCard
          label="Approved"
          value={String(approvedCount)}
          helper="Ready for trips"
          tone="success"
        />
        <MetricCard
          label="Needs review"
          value={String(pendingCount + suspendedCount)}
          helper="Pending or suspended"
          tone={pendingCount + suspendedCount > 0 ? "warning" : "default"}
        />
      </section>

      <section className="moovu-card p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search driver, phone, or email"
            className="min-h-11 rounded-2xl border border-[var(--moovu-border)] bg-white px-4 text-sm font-semibold text-slate-950 outline-none focus:border-[var(--moovu-blue)]"
          />
          <div className="flex flex-wrap gap-2">
            {["all", "pending", "approved", "active", "suspended"].map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
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
      </section>

      <section className="moovu-card overflow-hidden">
        {filteredDrivers.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No drivers found"
              description="Adjust your search or status filter to find driver profiles."
            />
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[840px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th className="px-5 py-4">Driver</th>
                    <th className="px-5 py-4">Phone</th>
                    <th className="px-5 py-4">Email</th>
                    <th className="px-5 py-4">Status</th>
                    <th className="px-5 py-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDrivers.map((driver) => (
                    <tr key={driver.id} className="border-t border-[var(--moovu-border)]">
                      <td className="px-5 py-4 font-black text-slate-950">
                        <Link href={`/admin/drivers/${driver.id}`} className="hover:text-[var(--moovu-blue)]">
                          {driverName(driver)}
                        </Link>
                      </td>
                      <td className="px-5 py-4 text-slate-700">{driver.phone ?? "--"}</td>
                      <td className="px-5 py-4 text-slate-700">{driver.email ?? "--"}</td>
                      <td className="px-5 py-4">
                        <StatusBadge status={driver.status} />
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
                          {driver.status !== "suspended" && (
                            <button
                              onClick={() => void updateStatus(driver.id, "suspended")}
                              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-black text-red-700"
                            >
                              Suspend
                            </button>
                          )}
                          {driver.status === "suspended" && (
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
            </div>

            <div className="grid gap-3 p-4 lg:hidden">
              {filteredDrivers.map((driver) => (
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
                        <StatusBadge status={driver.status} />
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
                    {driver.status !== "suspended" && (
                      <button
                        onClick={() => void updateStatus(driver.id, "suspended")}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-black text-red-700"
                      >
                        Suspend
                      </button>
                    )}
                    {driver.status === "suspended" && (
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
