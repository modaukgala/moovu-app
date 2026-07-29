"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import CompactTabs from "@/components/ui/CompactTabs";
import EmptyState from "@/components/ui/EmptyState";
import LoadingState from "@/components/ui/LoadingState";
import MetricCard from "@/components/ui/MetricCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { PageHeader } from "@/components/ui/MoovuPrimitives";
import { supabaseClient } from "@/lib/supabase/client";

type CustomerTrip = {
  id: string;
  status: string | null;
  fare_amount: number | null;
  final_fare?: number | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  payment_method: string | null;
  created_at: string | null;
  completed_at?: string | null;
};

type CustomerDetail = {
  id: string;
  auth_user_id?: string | null;
  account_source?: "customer_profile" | "auth_only";
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  created_at: string | null;
  last_activity: string | null;
  total_trips: number;
  completed_trips: number;
  cancelled_trips: number;
  total_spend: number;
  last_trip_status: string | null;
  trips: CustomerTrip[];
};

type ProfileTab =
  | "overview"
  | "trips"
  | "payments"
  | "receipts"
  | "support"
  | "benefits"
  | "activity";

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not available";
}

export default function AdminCustomerProfilePage() {
  const params = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ProfileTab>("overview");

  const loadCustomer = useCallback(async () => {
    const customerId = String(params.id ?? "");
    if (!customerId) return;

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

    const response = await fetch(
      `/api/admin/customers?customerId=${encodeURIComponent(customerId)}`,
      {
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.access_token}` },
      },
    );
    const json = await response.json().catch(() => null);

    if (!response.ok || !json?.ok || !json.customer) {
      setError(json?.error || "Customer profile could not be found.");
      setLoading(false);
      return;
    }

    setCustomer(json.customer);
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCustomer();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadCustomer]);

  const sortedTrips = useMemo(
    () =>
      [...(customer?.trips ?? [])].sort((a, b) =>
        String(b.completed_at || b.created_at || "").localeCompare(
          String(a.completed_at || a.created_at || ""),
        ),
      ),
    [customer?.trips],
  );

  if (loading) {
    return (
      <LoadingState
        title="Loading customer profile"
        description="Preparing trips, receipts, and recent activity."
      />
    );
  }

  if (!customer || error) {
    return (
      <main className="moovu-page text-slate-950">
        <div className="moovu-shell max-w-4xl">
          <EmptyState
            title="Customer profile unavailable"
            description={error || "This customer record could not be loaded."}
            action={
              <Link href="/admin/customers" className="moovu-btn moovu-btn-primary">
                Back to customers
              </Link>
            }
          />
        </div>
      </main>
    );
  }

  const customerName =
    `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim() ||
    "Unnamed customer";

  return (
    <main className="moovu-page text-slate-950">
      <div className="moovu-shell max-w-7xl space-y-5">
        <PageHeader
          kicker="Customer Profile"
          title={customerName}
          description={`${customer.phone ?? "No phone"} · ${customer.email ?? "No email saved"}`}
          actions={
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={customer.status ?? "active"} />
              <Link href="/admin/customers" className="moovu-btn moovu-btn-secondary">
                Back to customers
              </Link>
            </div>
          }
        />

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Total trips" value={String(customer.total_trips)} />
          <MetricCard label="Completed" value={String(customer.completed_trips)} tone="success" />
          <MetricCard label="Cancelled" value={String(customer.cancelled_trips)} tone="warning" />
          <MetricCard label="Total spend" value={money(customer.total_spend)} tone="primary" />
          <MetricCard label="Last trip" value={customer.last_trip_status ?? "No trips"} />
        </section>

        <section className="moovu-card p-4">
          <CompactTabs
            ariaLabel="Customer profile sections"
            value={tab}
            onChange={(value) => setTab(value as ProfileTab)}
            items={[
              { value: "overview", label: "Overview" },
              { value: "trips", label: "Trips", count: customer.total_trips },
              { value: "payments", label: "Payments" },
              { value: "receipts", label: "Receipts", count: customer.completed_trips },
              { value: "support", label: "Support" },
              { value: "benefits", label: "Benefits" },
              { value: "activity", label: "Activity" },
            ]}
          />
        </section>

        {tab === "overview" ? (
          <section className="grid gap-5 lg:grid-cols-2">
            <div className="moovu-card p-5 sm:p-6">
              <div className="moovu-section-title">Contact details</div>
              <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Phone</dt>
                  <dd className="mt-1 font-black text-slate-950">{customer.phone ?? "Not saved"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Email</dt>
                  <dd className="mt-1 break-words font-black text-slate-950">{customer.email ?? "Not saved"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Joined</dt>
                  <dd className="mt-1 font-black text-slate-950">{displayDate(customer.created_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Last activity</dt>
                  <dd className="mt-1 font-black text-slate-950">{displayDate(customer.last_activity)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">Profile state</dt>
                  <dd className="mt-1 font-black text-slate-950">
                    {customer.account_source === "auth_only" ? "Auth account only" : "Customer profile linked"}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="moovu-card p-5 sm:p-6">
              <div className="moovu-section-title">Latest trip</div>
              {sortedTrips[0] ? (
                <div className="mt-5 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <StatusBadge status={sortedTrips[0].status} />
                    <strong className="text-xl">{money(sortedTrips[0].final_fare ?? sortedTrips[0].fare_amount)}</strong>
                  </div>
                  <p className="font-black">{sortedTrips[0].pickup_address ?? "Pickup unavailable"}</p>
                  <p className="text-sm text-slate-600">{sortedTrips[0].dropoff_address ?? "Destination unavailable"}</p>
                  <Link href={`/admin/trips/${sortedTrips[0].id}`} className="moovu-btn moovu-btn-secondary">
                    Open trip
                  </Link>
                </div>
              ) : (
                <EmptyState title="No trips yet" description="This customer has not booked a recorded trip." />
              )}
            </div>
          </section>
        ) : null}

        {tab === "trips" || tab === "receipts" || tab === "activity" ? (
          <section className="moovu-card overflow-hidden p-0">
            {sortedTrips.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No trip activity" description="Customer trips will appear here after booking." />
              </div>
            ) : (
              <div className="divide-y divide-[var(--moovu-border)]">
                {sortedTrips
                  .filter((trip) => tab !== "receipts" || trip.status === "completed")
                  .map((trip) => (
                    <div
                      key={trip.id}
                      className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={trip.status} />
                          <span className="text-xs font-semibold text-slate-500">
                            {displayDate(trip.completed_at || trip.created_at)}
                          </span>
                        </div>
                        <p className="mt-2 truncate font-black text-slate-950">
                          {trip.pickup_address ?? "Pickup unavailable"}
                        </p>
                        <p className="mt-1 truncate text-sm text-slate-600">
                          {trip.dropoff_address ?? "Destination unavailable"}
                        </p>
                      </div>
                      <strong>{money(trip.final_fare ?? trip.fare_amount)}</strong>
                      <div className="flex flex-wrap gap-2">
                        <Link href={`/admin/trips/${trip.id}`} className="moovu-btn moovu-btn-secondary min-h-10 px-4 py-2 text-sm">
                          Trip
                        </Link>
                        {trip.status === "completed" ? (
                          <Link href={`/admin/receipts/${trip.id}`} className="moovu-btn moovu-btn-secondary min-h-10 px-4 py-2 text-sm">
                            Receipt
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </section>
        ) : null}

        {tab === "support" ? (
          <section className="moovu-card p-5 sm:p-6">
            <EmptyState
              title="Customer support"
              description="Use the existing trip support records from the relevant trip. No separate customer support data is invented here."
            />
          </section>
        ) : null}

        {tab === "payments" ? (
          <section className="moovu-card p-5 sm:p-6">
            {sortedTrips.length === 0 ? (
              <EmptyState
                title="No payment activity"
                description="Payment methods and completed trip values will appear here after this customer books."
              />
            ) : (
              <div className="divide-y divide-[var(--moovu-border)]">
                {sortedTrips.map((trip) => (
                  <div key={trip.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                    <div>
                      <div className="font-black text-slate-950">
                        {trip.payment_method || "Payment method not recorded"}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">
                        {displayDate(trip.completed_at || trip.created_at)}
                      </div>
                    </div>
                    <div className="text-right">
                      <strong>{money(trip.final_fare ?? trip.fare_amount)}</strong>
                      <div className="mt-1"><StatusBadge status={trip.status} /></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {tab === "benefits" ? (
          <section className="moovu-card p-5 sm:p-6">
            <EmptyState
              title="Customer benefits not configured"
              description="This area is ready for future customer subscriptions or ride benefits. No plan or entitlement is assigned automatically."
            />
          </section>
        ) : null}
      </div>
    </main>
  );
}
