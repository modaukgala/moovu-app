"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";

type DriverProfile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email?: string | null;
  status: string | null;
  online: boolean | null;
  busy: boolean | null;
  profile_completed: boolean | null;
  verification_status: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: string | null;
  vehicle_color?: string | null;
  vehicle_registration?: string | null;
  vehicle_vin?: string | null;
  vehicle_engine_number?: string | null;
  seating_capacity?: number | null;
  subscription_status?: string | null;
  subscription_plan?: string | null;
  subscription_expires_at?: string | null;
  subscription_amount_due?: number | null;
  subscription_last_paid_at?: string | null;
  subscription_last_payment_amount?: number | null;
  created_at?: string | null;
  is_deleted?: boolean | null;
  deleted_at?: string | null;
  delete_mode?: string | null;
  deleted_reason?: string | null;
  driver_profile?: {
    id_number?: string | null;
    home_address?: string | null;
    area_name?: string | null;
    emergency_contact_name?: string | null;
    emergency_contact_phone?: string | null;
    license_number?: string | null;
    license_code?: string | null;
    license_expiry?: string | null;
    pdp_number?: string | null;
    pdp_expiry?: string | null;
    vehicle_license_expiry?: string | null;
    insurance_expiry?: string | null;
  } | null;
};

type ValidationIssue = {
  field: string;
  label: string;
  message: string;
  severity: "ready" | "warning" | "blocked";
};

type CorrectionRow = {
  id: string;
  table_name: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  correction_reason: string;
  corrected_at: string;
};

type CorrectionDraft = {
  fieldName: string;
  label: string;
  currentValue: string;
  newValue: string;
  reason: string;
};

type SubscriptionPayment = {
  id: string;
  amount_paid: number;
  payment_method: string;
  reference: string | null;
  note: string | null;
  created_at: string | null;
};

type SubscriptionRequest = {
  id: string;
  plan_type: string;
  amount_expected: number;
  payment_reference: string;
  note: string | null;
  status: string;
  created_at: string;
  confirmed_at: string | null;
};

const PLAN_PRICES = {
  day: 45,
  week: 100,
  month: 250,
} as const;

const BANK_DETAILS = {
  bankName: "NEDBANK",
  accountName: "Current Account",
  accountNumber: "2129562558",
  branchCode: "198765",
};

function money(v: number | null | undefined) {
  return `R${Number(v ?? 0).toFixed(2)}`;
}

function documentStatus(value: string | null | undefined) {
  if (!value) return { label: "Not captured", className: "bg-slate-100 text-slate-700" };
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return { label: "Check date", className: "bg-amber-50 text-amber-800" };
  const daysLeft = Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000));
  if (daysLeft < 0) return { label: "Expired", className: "bg-red-50 text-red-700" };
  if (daysLeft <= 30) return { label: "Expiring soon", className: "bg-amber-50 text-amber-800" };
  return { label: "Valid", className: "bg-emerald-50 text-emerald-700" };
}

function displayDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString() : "--";
}

export default function AdminDriverProfilePage() {
  const params = useParams<{ id: string }>();
  const driverId = params.id;

  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [subscriptionPayments, setSubscriptionPayments] = useState<SubscriptionPayment[]>([]);
  const [subscriptionRequests, setSubscriptionRequests] = useState<SubscriptionRequest[]>([]);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [corrections, setCorrections] = useState<CorrectionRow[]>([]);
  const [correctionsReady, setCorrectionsReady] = useState(true);
  const [readinessScore, setReadinessScore] = useState(0);
  const [busy, setBusy] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState<CorrectionDraft | null>(null);

  const [planType, setPlanType] = useState<"day" | "week" | "month">("month");
  const [amountPaid, setAmountPaid] = useState("300");
  const [paymentMethod, setPaymentMethod] = useState("eft");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token ?? null;
  }, []);

  const loadAll = useCallback(async () => {
    setBusy(true);
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setBusy(false);
      setMsg("Missing access token.");
      return;
    }

    const profileRes = await fetch(`/api/admin/driver-profile?driverId=${encodeURIComponent(driverId)}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const profileJson = await profileRes.json().catch(() => null);

    if (!profileJson?.ok) {
      setBusy(false);
      setMsg(profileJson?.error || "Failed to load driver profile.");
      return;
    }

    setProfile(profileJson.profile ?? null);
    setSubscriptionPayments(profileJson.subscription_payments ?? []);
    setSubscriptionRequests(profileJson.subscription_requests ?? []);
    setValidationIssues(profileJson.validation_issues ?? []);
    setCorrections(profileJson.corrections ?? []);
    setCorrectionsReady(Boolean(profileJson.corrections_ready));
    setReadinessScore(Number(profileJson.readiness_score ?? 0));
    setBusy(false);
  }, [driverId, getAccessToken]);

  async function saveCorrection() {
    if (!correctionDraft) return;
    if (correctionDraft.reason.trim().length < 8) {
      setMsg("Add a clear correction reason before saving.");
      return;
    }

    setActionBusy(true);
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setActionBusy(false);
      setMsg("Missing access token.");
      return;
    }

    const res = await fetch("/api/admin/driver-corrections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        driverId,
        fieldName: correctionDraft.fieldName,
        newValue: correctionDraft.newValue,
        reason: correctionDraft.reason,
      }),
    });
    const json = await res.json().catch(() => null);
    setActionBusy(false);

    if (!res.ok || !json?.ok) {
      setMsg(json?.error || "Could not save this correction.");
      return;
    }

    setCorrectionDraft(null);
    setMsg("Driver correction saved with audit record.");
    await loadAll();
  }

  async function activateSubscription(requestId?: string) {
    if (!amountPaid || Number(amountPaid) <= 0) {
      setMsg("Enter a valid payment amount.");
      return;
    }

    setActionBusy(true);
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setActionBusy(false);
      setMsg("Missing access token.");
      return;
    }

    const res = await fetch("/api/admin/driver-subscription-activate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        driverId,
        planType,
        amountPaid: Number(amountPaid),
        paymentMethod,
        reference,
        note,
        requestId,
      }),
    });

    const json = await res.json().catch(() => null);
    setActionBusy(false);

    if (!json?.ok) {
      setMsg(json?.error || "Failed to activate subscription.");
      return;
    }

    setMsg(json?.message || "Subscription activated.");
    setReference("");
    setNote("");
    await loadAll();
  }

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    setAmountPaid(String(PLAN_PRICES[planType]));
  }, [planType]);

  const driverName = useMemo(() => {
    return `${profile?.first_name ?? ""} ${profile?.last_name ?? ""}`.trim() || "Unnamed Driver";
  }, [profile]);

  const editableFields = useMemo(
    () => [
      ["first_name", "First name", profile?.first_name],
      ["last_name", "Last name", profile?.last_name],
      ["phone", "Phone", profile?.phone],
      ["email", "Email", profile?.email],
      ["area_name", "Area / township", profile?.driver_profile?.area_name],
      ["home_address", "Home address", profile?.driver_profile?.home_address],
      ["emergency_contact_name", "Emergency contact", profile?.driver_profile?.emergency_contact_name],
      ["emergency_contact_phone", "Emergency phone", profile?.driver_profile?.emergency_contact_phone],
      ["id_number", "ID number", profile?.driver_profile?.id_number],
      ["license_number", "Licence number", profile?.driver_profile?.license_number],
      ["license_code", "Licence code", profile?.driver_profile?.license_code],
      ["license_expiry", "Licence expiry", profile?.driver_profile?.license_expiry],
      ["pdp_number", "PDP / PrDP number", profile?.driver_profile?.pdp_number],
      ["pdp_expiry", "PDP / PrDP expiry", profile?.driver_profile?.pdp_expiry],
      ["vehicle_make", "Vehicle make", profile?.vehicle_make],
      ["vehicle_model", "Vehicle model", profile?.vehicle_model],
      ["vehicle_year", "Vehicle year", profile?.vehicle_year],
      ["vehicle_color", "Vehicle colour", profile?.vehicle_color],
      ["vehicle_registration", "Number plate", profile?.vehicle_registration],
      ["vehicle_vin", "VIN", profile?.vehicle_vin],
      ["vehicle_engine_number", "Engine number", profile?.vehicle_engine_number],
      ["seating_capacity", "Seating capacity", profile?.seating_capacity == null ? null : String(profile.seating_capacity)],
    ] as const,
    [profile],
  );

  if (busy) {
    return (
      <main className="min-h-screen px-6 py-10 text-black">
        <div className="max-w-6xl mx-auto border rounded-[2rem] p-6 bg-white shadow-sm">
          Loading driver profile...
        </div>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="min-h-screen px-6 py-10 text-black">
        <div className="max-w-6xl mx-auto space-y-4">
          {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}
          <Link href="/admin/applications" className="inline-flex border rounded-xl px-4 py-2 bg-white">
            Back
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-gray-500">Admin Driver Profile</div>
            <h1 className="text-4xl font-semibold mt-1">{driverName}</h1>
            <p className="text-gray-700 mt-2">
              {profile.phone ?? "—"} • sub status: {profile.subscription_status ?? "—"} • plan: {profile.subscription_plan ?? "—"}
            </p>
          </div>

          <Link href="/admin/applications" className="inline-flex border rounded-xl px-4 py-2 bg-white">
            Back
          </Link>
        </div>

        {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

        {correctionDraft && (
          <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm">
            <section className="w-full max-w-lg rounded-[30px] bg-white p-5 shadow-2xl">
              <div className="moovu-section-title">Admin correction</div>
              <h2 className="mt-2 text-2xl font-black text-slate-950">{correctionDraft.label}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Corrections are audited with the original value, new value, admin user, timestamp, and reason.
              </p>
              <div className="mt-4 rounded-2xl bg-slate-50 p-3 text-sm">
                <div className="font-bold text-slate-500">Current value</div>
                <div className="mt-1 font-black text-slate-950">{correctionDraft.currentValue || "--"}</div>
              </div>
              <label className="mt-4 block">
                <span className="text-sm font-black text-slate-700">New value</span>
                <input
                  className="moovu-input mt-2"
                  value={correctionDraft.newValue}
                  onChange={(event) =>
                    setCorrectionDraft((current) => current ? { ...current, newValue: event.target.value } : current)
                  }
                />
              </label>
              <label className="mt-4 block">
                <span className="text-sm font-black text-slate-700">Correction reason</span>
                <textarea
                  className="moovu-input mt-2 min-h-28"
                  value={correctionDraft.reason}
                  onChange={(event) =>
                    setCorrectionDraft((current) => current ? { ...current, reason: event.target.value } : current)
                  }
                  placeholder="Example: Corrected spelling after checking uploaded ID document."
                />
              </label>
              <div className="mt-5 flex flex-wrap justify-end gap-3">
                <button className="moovu-btn moovu-btn-secondary" disabled={actionBusy} onClick={() => setCorrectionDraft(null)}>
                  Cancel
                </button>
                <button className="moovu-btn moovu-btn-primary" disabled={actionBusy} onClick={() => void saveCorrection()}>
                  {actionBusy ? "Saving..." : "Save correction"}
                </button>
              </div>
            </section>
          </div>
        )}

        <section className="grid md:grid-cols-4 gap-4">
          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Subscription Status</div>
            <div className="text-2xl font-semibold mt-2">{profile.subscription_status ?? "—"}</div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Current Plan</div>
            <div className="text-2xl font-semibold mt-2">{profile.subscription_plan ?? "—"}</div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Expires</div>
            <div className="text-lg font-semibold mt-2">
              {profile.subscription_expires_at
                ? new Date(profile.subscription_expires_at).toLocaleString()
                : "—"}
            </div>
          </div>

          <div className="border rounded-2xl p-5 bg-white shadow-sm">
            <div className="text-sm text-gray-600">Last Payment</div>
            <div className="text-lg font-semibold mt-2">
              {profile.subscription_last_paid_at
                ? money(profile.subscription_last_payment_amount)
                : "—"}
            </div>
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-2xl font-semibold">Document expiry tracking</h2>
          <p className="text-sm text-gray-700">
            Warnings are visible only. MOOVU does not automatically block drivers from these dates yet.
          </p>
          <div className="grid gap-3 md:grid-cols-4">
            {[
              ["Driver license", profile.driver_profile?.license_expiry],
              ["PDP", profile.driver_profile?.pdp_expiry],
              ["Vehicle license disc", profile.driver_profile?.vehicle_license_expiry],
              ["Insurance", profile.driver_profile?.insurance_expiry],
            ].map(([label, value]) => {
              const status = documentStatus(value);
              return (
                <div key={label} className="rounded-2xl border border-[var(--moovu-border)] bg-white p-4">
                  <div className="text-sm text-gray-600">{label}</div>
                  <div className="mt-2 text-lg font-semibold">{displayDate(value)}</div>
                  <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-black ${status.className}`}>
                    {status.label}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">Driver verification review</h2>
              <p className="mt-1 text-sm text-gray-700">
                Review saved profile, vehicle, documents, and approval blockers before approving this driver.
              </p>
            </div>
            <div className="rounded-2xl bg-sky-50 px-4 py-3 text-right">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-sky-700">Readiness</div>
              <div className="text-2xl font-black text-slate-950">{readinessScore}%</div>
            </div>
          </div>

          {validationIssues.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {validationIssues.map((item) => (
                <div
                  key={`${item.field}-${item.message}`}
                  className={`rounded-2xl px-3 py-2 text-sm font-bold ${
                    item.severity === "blocked"
                      ? "bg-red-50 text-red-800"
                      : "bg-amber-50 text-amber-900"
                  }`}
                >
                  <span className="font-black">{item.label}:</span> {item.message}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-emerald-50 p-4 text-sm font-black text-emerald-800">
              No validation blockers found.
            </div>
          )}
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">Profile and vehicle corrections</h2>
              <p className="mt-1 text-sm text-gray-700">
                Use corrections for small verified fixes only. Every change requires an audit reason.
              </p>
            </div>
            {!correctionsReady && (
              <span className="rounded-full bg-amber-50 px-4 py-2 text-xs font-black text-amber-800">
                Run corrections SQL
              </span>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {editableFields.map(([fieldName, label, currentValue]) => (
              <div key={fieldName} className="rounded-2xl border border-[var(--moovu-border)] bg-white p-4">
                <div className="text-sm font-bold text-gray-500">{label}</div>
                <div className="mt-1 break-words text-lg font-semibold">{currentValue || "--"}</div>
                <button
                  type="button"
                  className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-[var(--moovu-primary)]"
                  onClick={() =>
                    setCorrectionDraft({
                      fieldName,
                      label,
                      currentValue: String(currentValue ?? ""),
                      newValue: String(currentValue ?? ""),
                      reason: "",
                    })
                  }
                >
                  Correct
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-2xl font-semibold">Correction history</h2>
          {!correctionsReady ? (
            <div className="rounded-2xl bg-amber-50 p-4 text-sm font-bold text-amber-900">
              Correction audit table is not available yet. Run `docs/driver-admin-corrections-migration.sql`.
            </div>
          ) : corrections.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-600">
              No admin corrections recorded yet.
            </div>
          ) : (
            <div className="space-y-3">
              {corrections.map((row) => (
                <div key={row.id} className="rounded-2xl border border-[var(--moovu-border)] bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-black text-slate-950">{row.field_name.replaceAll("_", " ")}</div>
                      <div className="mt-1 text-sm text-slate-600">
                        {row.old_value || "--"} {"->"} {row.new_value || "--"}
                      </div>
                    </div>
                    <div className="text-sm font-bold text-slate-500">
                      {new Date(row.corrected_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="mt-2 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700">
                    {row.correction_reason}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-2xl font-semibold">Confirm Payment & Activate Prepaid Subscription</h2>

          <div className="grid md:grid-cols-4 gap-4">
            <select
              className="border rounded-xl p-3"
              value={planType}
              onChange={(e) => setPlanType(e.target.value as "day" | "week" | "month")}
            >
              <option value="day">Day Plan</option>
              <option value="week">Week Plan</option>
              <option value="month">Month Plan</option>
            </select>

            <input
              className="border rounded-xl p-3"
              type="number"
              min="0"
              step="0.01"
              value={amountPaid}
              onChange={(e) => setAmountPaid(e.target.value)}
              placeholder="Amount paid"
            />

            <select
              className="border rounded-xl p-3"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="eft">EFT</option>
              <option value="transfer">Transfer</option>
              <option value="deposit">Deposit</option>
              <option value="cash">Cash</option>
            </select>

            <input
              className="border rounded-xl p-3"
              placeholder="Reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          <input
            className="border rounded-xl p-3 w-full"
            placeholder="Optional note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <div className="border rounded-2xl p-4 space-y-2">
            <div><span className="text-gray-500">Bank:</span> {BANK_DETAILS.bankName}</div>
            <div><span className="text-gray-500">Account Name:</span> {BANK_DETAILS.accountName}</div>
            <div><span className="text-gray-500">Account Number:</span> {BANK_DETAILS.accountNumber}</div>
            <div><span className="text-gray-500">Branch Code:</span> {BANK_DETAILS.branchCode}</div>
          </div>

          <button
            onClick={() => activateSubscription()}
            disabled={actionBusy}
            className="rounded-xl px-4 py-3 text-white"
            style={{ background: "var(--moovu-primary)" }}
          >
            {actionBusy ? "Activating..." : "Confirm Payment & Activate"}
          </button>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-2xl font-semibold">Recent Subscription Requests</h2>

          {subscriptionRequests.length === 0 ? (
            <div>No subscription requests yet.</div>
          ) : (
            <div className="space-y-3">
              {subscriptionRequests.map((row) => (
                <div key={row.id} className="border rounded-xl p-4">
                  <div className="grid md:grid-cols-5 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Plan</div>
                      <div className="font-medium">{row.plan_type}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Expected</div>
                      <div className="font-medium">{money(row.amount_expected)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Reference</div>
                      <div className="font-medium">{row.payment_reference}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Status</div>
                      <div className="font-medium">{row.status}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Action</div>
                      {row.status === "pending" ? (
                        <button
                          onClick={() => {
                            setPlanType(row.plan_type as "day" | "week" | "month");
                            setAmountPaid(String(row.amount_expected));
                            setReference(row.payment_reference);
                            activateSubscription(row.id);
                          }}
                          disabled={actionBusy}
                          className="border rounded-xl px-3 py-2 bg-white"
                        >
                          Confirm & Activate
                        </button>
                      ) : (
                        <div className="font-medium">Done</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-2xl font-semibold">Subscription Payment History</h2>

          {subscriptionPayments.length === 0 ? (
            <div>No subscription payments recorded yet.</div>
          ) : (
            <div className="space-y-3">
              {subscriptionPayments.map((row) => (
                <div key={row.id} className="border rounded-xl p-4">
                  <div className="grid md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-sm text-gray-500">Amount</div>
                      <div className="font-medium">{money(row.amount_paid)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Method</div>
                      <div className="font-medium">{row.payment_method}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Reference</div>
                      <div className="font-medium">{row.reference || "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Date</div>
                      <div className="font-medium">
                        {row.created_at ? new Date(row.created_at).toLocaleString() : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
