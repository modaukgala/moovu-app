"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import CompactTabs from "@/components/ui/CompactTabs";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import MetricCard from "@/components/ui/MetricCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { PageHeader } from "@/components/ui/MoovuPrimitives";
import { supabaseClient } from "@/lib/supabase/client";

type CustomerSummary = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  created_at: string | null;
  total_trips: number;
  completed_trips: number;
  cancelled_trips: number;
  total_spend: number;
  last_trip_status: string | null;
  last_activity: string | null;
};

type CustomerFilter = "all" | "active" | "inactive" | "has_trips" | "no_trips" | "recent";

function displayDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "No activity yet";
}

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CustomerFilter>("all");
  const [recentCutoff] = useState(() => Date.now() - 30 * 24 * 60 * 60 * 1000);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      setError("Your admin session has expired. Please sign in again.");
      setLoading(false);
      return;
    }

    const response = await fetch("/api/admin/customers", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const json = await response.json().catch(() => null);

    if (!response.ok || !json?.ok) {
      setError(json?.error || "Could not load customers. Please try again.");
      setLoading(false);
      return;
    }

    setCustomers(json.customers ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCustomers();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadCustomers]);

  const counts = useMemo(() => {
    return {
      all: customers.length,
      active: customers.filter((customer) => customer.status !== "inactive").length,
      inactive: customers.filter((customer) => customer.status === "inactive").length,
      has_trips: customers.filter((customer) => customer.total_trips > 0).length,
      no_trips: customers.filter((customer) => customer.total_trips === 0).length,
      recent: customers.filter(
        (customer) => customer.created_at && new Date(customer.created_at).getTime() >= recentCutoff,
      ).length,
    };
  }, [customers, recentCutoff]);

  const filteredCustomers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return customers.filter((customer) => {
      const matchesSearch =
        !normalizedQuery ||
        [
          customer.first_name,
          customer.last_name,
          customer.phone,
          customer.email,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      if (!matchesSearch) return false;
      if (filter === "active") return customer.status !== "inactive";
      if (filter === "inactive") return customer.status === "inactive";
      if (filter === "has_trips") return customer.total_trips > 0;
      if (filter === "no_trips") return customer.total_trips === 0;
      if (filter === "recent") {
        return Boolean(
          customer.created_at && new Date(customer.created_at).getTime() >= recentCutoff,
        );
      }
      return true;
    });
  }, [customers, filter, query, recentCutoff]);

  if (loading) {
    return (
      <LoadingState
        title="Loading customers"
        description="Preparing customer profiles and trip activity."
      />
    );
  }

  return (
    <main className="moovu-page text-slate-950">
      <div className="moovu-shell max-w-7xl space-y-5">
        <PageHeader
          kicker="Customer Operations"
          title="Customers"
          description="Search registered riders, review activity, and open a complete customer profile."
          actions={
            <button type="button" className="moovu-btn moovu-btn-secondary" onClick={loadCustomers}>
              Refresh
            </button>
          }
        />

        {error ? (
          <section className="rounded-3xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
            {error}
          </section>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Registered" value={String(customers.length)} helper="Customer accounts" />
          <MetricCard label="Active" value={String(counts.active)} helper="Available accounts" tone="success" />
          <MetricCard label="With trips" value={String(counts.has_trips)} helper="Customers who have booked" tone="primary" />
          <MetricCard label="New" value={String(counts.recent)} helper="Registered in 30 days" />
        </section>

        <section className="moovu-card space-y-4 p-4 sm:p-5">
          <label className="block">
            <span className="sr-only">Search customers</span>
            <input
              className="moovu-input bg-white"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, phone, or email"
            />
          </label>

          <CompactTabs
            ariaLabel="Customer filters"
            value={filter}
            onChange={(value) => setFilter(value as CustomerFilter)}
            items={[
              { value: "all", label: "All", count: counts.all },
              { value: "active", label: "Active", count: counts.active },
              { value: "inactive", label: "Inactive", count: counts.inactive },
              { value: "has_trips", label: "Has trips", count: counts.has_trips },
              { value: "no_trips", label: "No trips", count: counts.no_trips },
              { value: "recent", label: "Recent", count: counts.recent },
            ]}
          />
        </section>

        <section className="moovu-card overflow-hidden p-0">
          <div className="hidden grid-cols-[minmax(220px,1.3fr)_minmax(150px,0.8fr)_120px_130px_160px_110px] gap-4 border-b border-[var(--moovu-border)] bg-slate-50 px-5 py-3 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 lg:grid">
            <span>Customer</span>
            <span>Contact</span>
            <span>Trips</span>
            <span>Last status</span>
            <span>Last activity</span>
            <span>Account</span>
          </div>

          {filteredCustomers.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No customers found"
                description="Try a different search or customer filter."
              />
            </div>
          ) : (
            <div className="divide-y divide-[var(--moovu-border)]">
              {filteredCustomers.map((customer) => {
                const name =
                  `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim() ||
                  "Unnamed customer";

                return (
                  <Link
                    key={customer.id}
                    href={`/admin/customers/${customer.id}`}
                    className="grid gap-3 px-5 py-4 transition hover:bg-sky-50/50 lg:grid-cols-[minmax(220px,1.3fr)_minmax(150px,0.8fr)_120px_130px_160px_110px] lg:items-center lg:gap-4"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-black text-slate-950">{name}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        Joined {displayDate(customer.created_at)}
                      </div>
                    </div>
                    <div className="min-w-0 text-sm text-slate-600">
                      <div>{customer.phone ?? "No phone"}</div>
                      <div className="truncate text-xs">{customer.email ?? "No email saved"}</div>
                    </div>
                    <div className="text-sm font-black text-slate-950">
                      {customer.total_trips}
                      <span className="ml-1 font-semibold text-slate-500">
                        ({customer.completed_trips} done)
                      </span>
                    </div>
                    <StatusBadge status={customer.last_trip_status ?? "no_trips"} />
                    <div className="text-xs font-semibold text-slate-600">
                      {displayDate(customer.last_activity)}
                    </div>
                    <StatusBadge status={customer.status ?? "active"} />
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
