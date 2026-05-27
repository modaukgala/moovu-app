"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import EmptyState from "@/components/ui/EmptyState";
import DriverAuthRequired from "@/components/ui/DriverAuthRequired";
import LoadingState from "@/components/ui/LoadingState";
import MetricCard from "@/components/ui/MetricCard";
import StatusBadge from "@/components/ui/StatusBadge";
import { supabaseClient } from "@/lib/supabase/client";
import { DRIVER_SUBSCRIPTION_PLANS, type DriverSubscriptionPlan } from "@/lib/finance/driverPayments";

type Wallet = {
  balance_due: number | null;
  total_commission: number | null;
  total_driver_net: number | null;
  total_trips_completed: number | null;
};

type DriverInfo = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  subscription_status: string | null;
  subscription_plan: string | null;
  subscription_expires_at: string | null;
  subscription_amount_due: number | null;
};

type PaymentRequest = {
  id: string;
  payment_type: "subscription" | "commission" | "combined";
  subscription_plan: "day" | "week" | "month" | null;
  amount_expected: number;
  amount_submitted: number;
  payment_reference: string;
  note: string | null;
  pop_file_url: string | null;
  status: string;
  review_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
};

type Settlement = {
  id: string;
  amount_paid: number;
  payment_method: string;
  reference: string | null;
  note: string | null;
  created_at: string;
};

type SubscriptionPayment = {
  id: string;
  amount_paid: number;
  payment_method: string;
  reference: string | null;
  note: string | null;
  created_at: string;
};

type CompletedTrip = {
  id: string;
  fare_amount: number | null;
  commission_amount: number | null;
  driver_net_earnings: number | null;
  payment_method: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  created_at: string | null;
  completed_at?: string | null;
};

type CancellationFee = {
  id: string;
  trip_id: string;
  fee_type: string;
  fee_amount: number | null;
  driver_amount: number | null;
  moovu_amount: number | null;
  reason: string | null;
  created_at: string | null;
};

type PlanType = DriverSubscriptionPlan;

function money(value: number | null | undefined) {
  return `R${Number(value ?? 0).toFixed(2)}`;
}

function displayValue(value: string | null | undefined) {
  return value?.trim() || "--";
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "--";
}

function tripDate(trip: CompletedTrip) {
  return trip.completed_at || trip.created_at || "";
}

export default function DriverEarningsPage() {
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [driver, setDriver] = useState<DriverInfo | null>(null);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [subscriptionPayments, setSubscriptionPayments] = useState<SubscriptionPayment[]>([]);
  const [trips, setTrips] = useState<CompletedTrip[]>([]);
  const [cancellationFees, setCancellationFees] = useState<CancellationFee[]>([]);
  const [cancellationDriverEarnings, setCancellationDriverEarnings] = useState(0);
  const [lateCancellationDriverEarnings, setLateCancellationDriverEarnings] = useState(0);
  const [noShowDriverEarnings, setNoShowDriverEarnings] = useState(0);

  const [selectedPlan, setSelectedPlan] = useState<PlanType>("month");

  const getToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token || "";
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setMsg(null);

    const token = await getToken();
    if (!token) {
      setAuthRequired(true);
      setLoading(false);
      return;
    }

    setAuthRequired(false);

    const res = await fetch("/api/driver/earnings", {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to load MOOVU payments.");
      setLoading(false);
      return;
    }

    setWallet(json.earnings?.wallet ?? null);
    setDriver(json.earnings?.driver ?? null);
    setPaymentRequests(json.earnings?.payment_requests ?? []);
    setSettlements(json.earnings?.settlements ?? []);
    setSubscriptionPayments(json.earnings?.subscription_payments ?? []);
    setTrips(json.earnings?.recent_completed_trips ?? []);
    setCancellationFees(json.earnings?.cancellation_fees ?? []);
    setCancellationDriverEarnings(Number(json.earnings?.cancellation_driver_earnings ?? 0));
    setLateCancellationDriverEarnings(Number(json.earnings?.late_cancellation_driver_earnings ?? 0));
    setNoShowDriverEarnings(Number(json.earnings?.no_show_driver_earnings ?? 0));
    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadData]);

  const commissionDue = Number(wallet?.balance_due ?? 0);
  const subscriptionSelectedPrice = DRIVER_SUBSCRIPTION_PLANS[selectedPlan].amount;

  const now = useMemo(() => new Date(), []);
  const todayStart = useMemo(
    () => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(),
    [now],
  );
  const weekStart = useMemo(() => todayStart - 6 * 24 * 60 * 60 * 1000, [todayStart]);
  const monthStart = useMemo(
    () => new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    [now],
  );

  const earningsSummary = useMemo(() => {
    return trips.reduce(
      (summary, trip) => {
        const earned = Number(trip.driver_net_earnings ?? trip.fare_amount ?? 0);
        const dateMs = tripDate(trip) ? new Date(tripDate(trip)).getTime() : 0;

        summary.total += earned;
        if (dateMs >= todayStart) summary.today += earned;
        if (dateMs >= weekStart) summary.week += earned;
        if (dateMs >= monthStart) summary.month += earned;
        return summary;
      },
      { today: 0, week: 0, month: 0, total: 0 },
    );
  }, [monthStart, todayStart, trips, weekStart]);

  if (loading) {
    return (
      <LoadingState
        title="Loading driver earnings"
        description="Preparing earnings, commission balance, subscriptions, and payment history."
      />
    );
  }

  if (authRequired) {
    return <DriverAuthRequired description="Sign in to view your earnings, subscription status, and MOOVU commission balance." />;
  }

  return (
    <main className="moovu-page moovu-driver-shell text-black">
      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="moovu-shell space-y-6">
        <div className="moovu-hero-panel p-5 sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-white/70">MOOVU Driver</div>
              <h1 className="mt-2 text-2xl font-black text-white sm:text-4xl">Earnings and payments</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/74">
                Track your trip earnings, subscription status, and MOOVU commission balance from one clean wallet view.
              </p>
            </div>

            <div className="moovu-action-row">
              <Link href="/driver" className="moovu-btn bg-white text-slate-950">
                Dashboard
              </Link>
              <Link href="/driver/commission-payments" className="moovu-btn bg-white text-slate-950">
                Commission
              </Link>
              <Link href="/driver/subscriptions" className="moovu-btn bg-white text-slate-950">
                Subscriptions
              </Link>
            </div>
          </div>
        </div>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard label="Today" value={money(earningsSummary.today)} helper="Recent completed trips" />
          <MetricCard label="This week" value={money(earningsSummary.week)} helper="Last 7 days" />
          <MetricCard label="This month" value={money(earningsSummary.month)} helper="Current month" />
          <MetricCard label="Total earned" value={money(Number(wallet?.total_driver_net ?? earningsSummary.total) + cancellationDriverEarnings)} helper={`${wallet?.total_trips_completed ?? trips.length} completed trips + fees`} tone="primary" />
          <MetricCard label="Commission owed" value={money(commissionDue)} helper="Payable to MOOVU" tone={commissionDue > 0 ? "warning" : "success"} />
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <MetricCard
            label="Cancellation payouts"
            value={money(lateCancellationDriverEarnings)}
            helper="R10 driver payout per late cancellation"
            tone={lateCancellationDriverEarnings > 0 ? "warning" : "default"}
          />
          <MetricCard
            label="No-show payouts"
            value={money(noShowDriverEarnings)}
            helper="R22 driver payout per no-show"
            tone={noShowDriverEarnings > 0 ? "primary" : "default"}
          />
          <MetricCard
            label="Fee payouts total"
            value={money(cancellationDriverEarnings)}
            helper="Separate from MOOVU commission debt"
            tone="success"
          />
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <div className="moovu-card p-5">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Subscription</div>
            <div className="mt-2"><StatusBadge status={driver?.subscription_status} /></div>
          </div>
          <div className="moovu-card p-5">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Current plan</div>
            <div className="mt-2 text-xl font-black text-slate-950">{displayValue(driver?.subscription_plan)}</div>
          </div>
          <div className="moovu-card p-5">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Expires</div>
            <div className="mt-2 text-sm font-black text-slate-950">
              {displayDate(driver?.subscription_expires_at)}
            </div>
          </div>
        </section>

        <section className="moovu-card p-5 sm:p-6 space-y-4">
          <h2 className="text-xl font-black text-slate-950">Payment areas</h2>

          <div className="grid lg:grid-cols-2 gap-4">
            <div className="moovu-card-interactive space-y-4 p-5">
              <div className="moovu-section-title">Subscription Payment</div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  className={`moovu-btn justify-center px-3 ${selectedPlan === "day" ? "moovu-btn-primary" : "moovu-btn-secondary"}`}
                  onClick={() => setSelectedPlan("day")}
                >
                  {DRIVER_SUBSCRIPTION_PLANS.day.label} {money(DRIVER_SUBSCRIPTION_PLANS.day.amount)}
                </button>
                <button
                  className={`moovu-btn justify-center px-3 ${selectedPlan === "week" ? "moovu-btn-primary" : "moovu-btn-secondary"}`}
                  onClick={() => setSelectedPlan("week")}
                >
                  {DRIVER_SUBSCRIPTION_PLANS.week.label} {money(DRIVER_SUBSCRIPTION_PLANS.week.amount)}
                </button>
                <button
                  className={`moovu-btn justify-center px-3 ${selectedPlan === "month" ? "moovu-btn-primary" : "moovu-btn-secondary"}`}
                  onClick={() => setSelectedPlan("month")}
                >
                  {DRIVER_SUBSCRIPTION_PLANS.month.label} {money(DRIVER_SUBSCRIPTION_PLANS.month.amount)}
                </button>
              </div>
              <div className="text-2xl font-black text-slate-950">{money(subscriptionSelectedPrice)}</div>
              <Link href="/driver/subscriptions" className="moovu-btn moovu-btn-primary w-full justify-center">
                Open subscription payments
              </Link>
            </div>

            <div className="moovu-card-interactive space-y-4 p-5">
              <div className="moovu-section-title">Commission Payment</div>
              <div className="text-2xl font-black text-slate-950">{money(commissionDue)}</div>
              <Link href="/driver/commission-payments" className="moovu-btn moovu-btn-primary w-full justify-center">
                Open commission payments
              </Link>
            </div>
          </div>
        </section>

        <section className="moovu-card p-5 sm:p-6 space-y-4">
          <h2 className="text-xl font-black text-slate-950">Submitted payment requests</h2>

          {paymentRequests.length === 0 ? (
            <EmptyState
              title="No payment requests yet"
              description="Submitted subscription and commission proof of payment requests will appear here."
            />
          ) : (
            <div className="space-y-3">
              {paymentRequests.map((row) => (
                <div key={row.id} className="moovu-card-interactive p-4">
                  <div className="grid md:grid-cols-6 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Type</div>
                      <div className="font-medium">{row.payment_type}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Plan</div>
                      <div className="font-medium">{displayValue(row.subscription_plan)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Expected</div>
                      <div className="font-medium">{money(row.amount_expected)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Submitted</div>
                      <div className="font-medium">{money(row.amount_submitted)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Reference</div>
                      <div className="font-medium">{row.payment_reference}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Status</div>
                      <StatusBadge status={row.status} />
                    </div>
                  </div>

                  {row.pop_file_url && (
                    <div className="mt-3">
                      <a
                        href={row.pop_file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="moovu-btn moovu-btn-secondary"
                      >
                        View POP
                      </a>
                    </div>
                  )}

                  {row.review_note && (
                    <div className="mt-3 text-sm text-gray-700">
                      Review note: {row.review_note}
                    </div>
                  )}

                  <div className="text-xs text-gray-500 mt-3">
                    Submitted: {new Date(row.submitted_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="grid lg:grid-cols-2 gap-6">
          <div className="moovu-card p-5 sm:p-6 space-y-4">
            <h2 className="text-xl font-black text-slate-950">Commission payment history</h2>

            {settlements.length === 0 ? (
              <EmptyState
                title="No commission payments"
                description="Approved commission settlement records will appear here."
              />
            ) : (
              <div className="space-y-3">
                {settlements.map((row) => (
                  <div key={row.id} className="moovu-card-interactive p-4">
                    <div>{money(row.amount_paid)} - {row.payment_method}</div>
                    <div className="text-sm text-gray-500 mt-1">{displayValue(row.reference)}</div>
                    <div className="text-xs text-gray-500 mt-2">{displayDate(row.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="moovu-card p-5 sm:p-6 space-y-4">
            <h2 className="text-xl font-black text-slate-950">Subscription payment history</h2>

            {subscriptionPayments.length === 0 ? (
              <EmptyState
                title="No subscription payments"
                description="Approved subscription payments will appear here."
              />
            ) : (
              <div className="space-y-3">
                {subscriptionPayments.map((row) => (
                  <div key={row.id} className="moovu-card-interactive p-4">
                    <div>{money(row.amount_paid)} - {row.payment_method}</div>
                    <div className="text-sm text-gray-500 mt-1">{displayValue(row.reference)}</div>
                    <div className="text-xs text-gray-500 mt-2">{displayDate(row.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="moovu-card p-5 sm:p-6 space-y-4">
          <h2 className="text-xl font-black text-slate-950">Cancellation and no-show payouts</h2>

          {cancellationFees.length === 0 ? (
            <EmptyState
              title="No cancellation payouts"
              description="Late cancellation and no-show driver payouts will appear here."
            />
          ) : (
            <div className="space-y-3">
              {cancellationFees.map((row) => (
                <div key={row.id} className="moovu-card-interactive p-4">
                  <div className="grid gap-3 md:grid-cols-5">
                    <div>
                      <div className="text-sm text-gray-500">Type</div>
                      <div className="font-medium">{row.fee_type === "no_show" ? "No-show" : "Late cancellation"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Customer fee</div>
                      <div className="font-medium">{money(row.fee_amount)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Your payout</div>
                      <div className="font-medium">{money(row.driver_amount)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Reason</div>
                      <div className="font-medium">{displayValue(row.reason)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Recorded</div>
                      <div className="font-medium">{displayDate(row.created_at)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="moovu-card p-5 sm:p-6 space-y-4">
          <h2 className="text-xl font-black text-slate-950">Recent completed trips</h2>

          {trips.length === 0 ? (
            <EmptyState
              title="No completed trips"
              description="Completed trip earnings will appear here after your first finished ride."
            />
          ) : (
            <div className="space-y-3">
              {trips.map((trip) => (
                <div key={trip.id} className="moovu-card-interactive p-4">
                  <div className="grid md:grid-cols-5 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Pickup</div>
                      <div className="font-medium">{displayValue(trip.pickup_address)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Dropoff</div>
                      <div className="font-medium">{displayValue(trip.dropoff_address)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Fare</div>
                      <div className="font-medium">{money(trip.fare_amount)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Commission</div>
                      <div className="font-medium">{money(trip.commission_amount)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Completed</div>
                      <div className="font-medium">{displayDate(trip.completed_at ?? trip.created_at)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <DriverBottomNav />
    </main>
  );
}
