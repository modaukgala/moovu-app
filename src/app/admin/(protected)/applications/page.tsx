"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import EmptyState from "@/components/ui/EmptyState";
import StatusBadge from "@/components/ui/StatusBadge";

type ApplicationRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  profile_completed: boolean | null;
  verification_status: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: string | null;
  vehicle_color?: string | null;
  vehicle_registration?: string | null;
  created_at: string | null;
  readiness_score?: number | null;
  pdp_status?: string | null;
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
  } | null;
  validation_issues?: {
    field: string;
    label: string;
    message: string;
    severity: "ready" | "warning" | "blocked";
  }[];
  approval_blockers?: {
    field: string;
    label: string;
    message: string;
    severity: "ready" | "warning" | "blocked";
  }[];
};

export default function AdminDriverApplicationsPage() {
  const [filter, setFilter] = useState("all");
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [selected, setSelected] = useState<ApplicationRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"approve" | "suspend" | "delete" | null>(null);

  const getAccessToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token ?? null;
  }, []);

  const loadApplications = useCallback(
    async (nextFilter?: string) => {
      setBusy(true);
      setMsg(null);

      try {
        const token = await getAccessToken();

        if (!token) {
          setApplications([]);
          setSelected(null);
          setMsg("Missing access token.");
          return;
        }

        const useFilter = nextFilter ?? filter;

        const res = await fetch(
          `/api/admin/driver-applications?status=${encodeURIComponent(useFilter)}`,
          {
            method: "GET",
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const json = await res.json().catch(() => null);

        if (!json?.ok) {
          setApplications([]);
          setSelected(null);
          setMsg(json?.error || "Failed to load applications.");
          return;
        }

        const rows = (json.applications ?? []) as ApplicationRow[];
        setApplications(rows);
        setSelected((current) => {
          if (!rows.length) return null;
          if (current) {
            const match = rows.find((row) => row.id === current.id);
            if (match) return match;
          }
          return rows[0] ?? null;
        });
      } catch {
        setApplications([]);
        setSelected(null);
        setMsg("Failed to load applications.");
      } finally {
        setBusy(false);
      }
    },
    [filter, getAccessToken]
  );

  useEffect(() => {
    void loadApplications("all");
  }, [loadApplications]);

  const selectedVehicle = useMemo(() => {
    if (!selected) return "--";
    return [selected.vehicle_make, selected.vehicle_model].filter(Boolean).join(" ") || "--";
  }, [selected]);

  const selectedPdpLabel = useMemo(() => {
    if (!selected) return "Not available yet";
    if (selected.driver_profile?.pdp_number) return "Uploaded";
    if (selected.pdp_status === "applying") return "Applying for one";
    if (selected.pdp_status === "requested") return "Requested by admin";
    if (selected.pdp_status === "verified") return "Verified";
    if (selected.pdp_status === "rejected") return "Rejected / needs re-upload";
    return "Not available yet";
  }, [selected]);

  async function runApplicationAction(action: "approve" | "suspend" | "delete") {
    if (!selected) return;

    setBusy(true);
    setMsg(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        setMsg("Missing access token.");
        return;
      }

      const endpoint =
        action === "approve"
          ? "/api/admin/driver-verification"
          : action === "suspend"
            ? "/api/admin/drivers/status"
            : "/api/admin/drivers/remove";
      const body =
        action === "approve"
          ? { driverId: selected.id, verificationStatus: "approved" }
          : action === "suspend"
            ? { driverId: selected.id, status: "inactive" }
            : {
                driverId: selected.id,
                mode: "deactivate",
                reason: "Driver application removed by admin review.",
              };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Could not update this application. Please try again.");
        return;
      }

      setConfirmAction(null);
      setMsg(
        action === "approve"
          ? "Application approved. The driver can complete access requirements and operate when eligible."
          : action === "suspend"
            ? "Application suspended. The driver cannot go online until reactivated."
            : "Application removed from the active review queue.",
      );
      await loadApplications(filter);
    } catch {
      setMsg("Could not update this application. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="moovu-page min-h-screen text-slate-950">
      <div className="moovu-shell max-w-6xl space-y-6 py-6 sm:py-8">
        <section className="moovu-card overflow-hidden p-0">
          <div className="bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-5 sm:p-7">
            <div className="moovu-section-title">Driver Onboarding</div>
            <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-3xl font-black sm:text-4xl">Driver Applications</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  Approve, link, review profile details, inspect registered applicants.
                </p>
              </div>
              <div className="rounded-3xl bg-white/80 px-5 py-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Queue</div>
                <div className="mt-1 text-3xl font-black">{applications.length}</div>
              </div>
            </div>
          </div>
        </section>

        <div className="moovu-card flex flex-wrap items-center gap-3 p-4">
          <select
            className="moovu-input max-w-xs bg-white"
            value={filter}
            onChange={(e) => {
              const value = e.target.value;
              setFilter(value);
              void loadApplications(value);
            }}
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="pending_review">Pending Review</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>

          <button className="moovu-btn moovu-btn-primary" disabled={busy} onClick={() => void loadApplications()}>
            {busy ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

        {confirmAction && selected && (
          <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm">
            <section className="w-full max-w-lg rounded-[30px] bg-white p-5 shadow-2xl">
              <div className="moovu-section-title">Application action</div>
              <h2 className="mt-2 text-2xl font-black text-slate-950">
                {confirmAction === "approve"
                  ? "Approve driver application"
                  : confirmAction === "suspend"
                    ? "Suspend driver application"
                    : "Delete application"}
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {confirmAction === "approve"
                  ? "Approve only after profile, vehicle, phone, and document checks are complete."
                  : confirmAction === "suspend"
                    ? "This keeps the record but blocks the driver from operating until admin reactivates them."
                    : "This removes the applicant from the active queue using the safe deactivation flow. Existing records are preserved."}
              </p>
              <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                <div className="text-sm font-bold text-slate-500">Applicant</div>
                <div className="mt-1 font-black text-slate-950">
                  {selected.first_name ?? "--"} {selected.last_name ?? ""}
                </div>
                <div className="mt-1 text-sm text-slate-600">{selected.phone ?? selected.email ?? selected.id}</div>
              </div>
              <div className="mt-5 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  className="moovu-btn moovu-btn-secondary"
                  onClick={() => setConfirmAction(null)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={confirmAction === "approve" ? "moovu-btn moovu-btn-primary" : "moovu-btn moovu-btn-secondary text-red-600"}
                  onClick={() => void runApplicationAction(confirmAction)}
                  disabled={busy}
                >
                  {busy
                    ? "Working..."
                    : confirmAction === "approve"
                      ? "Approve"
                      : confirmAction === "suspend"
                        ? "Suspend"
                        : "Delete"}
                </button>
              </div>
            </section>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="moovu-card p-5 sm:p-6">
            <div className="moovu-section-title">Applications Queue</div>
            <h2 className="mt-2 text-2xl font-black">Applications ({applications.length})</h2>

            <div className="mt-5 space-y-3">
              {applications.length === 0 ? (
                <EmptyState title="No applications found" description="Try another status filter or refresh the queue." />
              ) : (
                applications.map((app) => {
                  const name =
                    `${app.first_name ?? ""} ${app.last_name ?? ""}`.trim() || "Unnamed";

                  return (
                    <button
                      key={app.id}
                      className={`moovu-card-interactive w-full p-4 text-left transition ${
                        selected?.id === app.id ? "ring-2 ring-[var(--moovu-primary)]" : ""
                      }`}
                      onClick={() => setSelected(app)}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="font-black text-slate-950">{name}</div>
                          <div className="mt-1 text-sm text-slate-600">{app.phone ?? "--"}</div>
                        </div>
                        <StatusBadge status={app.status} />
                      </div>
                      <div className="mt-3 text-sm text-slate-600">
                        Verification: {app.verification_status ?? "--"}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
                          Readiness {app.readiness_score ?? 0}%
                        </span>
                        {(app.approval_blockers?.length ?? 0) > 0 && (
                          <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-black text-red-700">
                            {app.approval_blockers?.length} blocker(s)
                          </span>
                        )}
                        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-800">
                          PDP {app.driver_profile?.pdp_number ? "uploaded" : "not yet"}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="moovu-card p-5 sm:p-6">
            <div className="moovu-section-title">Application Review</div>
            <h2 className="mt-2 text-2xl font-black">Details</h2>

            {!selected ? (
              <EmptyState
                title="Select an application"
                description="Choose a driver from the queue to review profile and vehicle details."
              />
            ) : (
              <div className="mt-5 space-y-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="text-sm font-bold text-slate-500">Applicant</div>
                    <div className="mt-1 text-xl font-black">
                      {selected.first_name ?? "--"} {selected.last_name ?? ""}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-bold text-slate-500">Phone</div>
                    <div className="mt-1 text-xl font-black">{selected.phone ?? "--"}</div>
                  </div>

                  <div>
                    <div className="text-sm font-bold text-slate-500">Email</div>
                    <div className="mt-1 break-words text-xl font-black">{selected.email ?? "--"}</div>
                  </div>

                  <div>
                    <div className="text-sm font-bold text-slate-500">Verification</div>
                    <div className="mt-2">
                      <StatusBadge status={selected.verification_status} />
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-bold text-slate-500">Readiness Score</div>
                    <div className="mt-1 text-xl font-black">{selected.readiness_score ?? 0}%</div>
                  </div>

                  <div>
                    <div className="text-sm font-bold text-slate-500">PDP / PrDP Status</div>
                    <div className="mt-1 text-xl font-black">{selectedPdpLabel}</div>
                  </div>

                  <div>
                    <div className="text-sm font-bold text-slate-500">Vehicle</div>
                    <div className="mt-1 text-xl font-black">{selectedVehicle}</div>
                  </div>

                  <div>
                    <div className="text-sm font-bold text-slate-500">Registration</div>
                    <div className="mt-1 text-xl font-black">
                      {selected.vehicle_registration ?? "--"}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-bold text-slate-500">Vehicle Details</div>
                    <div className="mt-1 text-xl font-black">
                      {[selected.vehicle_year, selected.vehicle_color].filter(Boolean).join(" - ") || "--"}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm font-bold text-slate-500">Created</div>
                    <div className="mt-1 text-xl font-black">
                      {selected.created_at ? new Date(selected.created_at).toLocaleString() : "--"}
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-sky-100 bg-sky-50/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black uppercase tracking-[0.14em] text-sky-800">
                        Verification checklist
                      </div>
                      <p className="mt-1 text-sm text-slate-600">
                        Confirm these details before approving the driver.
                      </p>
                    </div>
                    <StatusBadge status={selected.verification_status} />
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {[
                      { label: "Name captured", ok: Boolean(selected.first_name || selected.last_name) },
                      { label: "Phone captured", ok: Boolean(selected.phone) },
                      { label: "Email captured", ok: Boolean(selected.email) },
                      { label: "Identity captured", ok: Boolean(selected.driver_profile?.id_number) },
                      { label: "Address captured", ok: Boolean(selected.driver_profile?.home_address || selected.driver_profile?.area_name) },
                      { label: "Emergency contact captured", ok: Boolean(selected.driver_profile?.emergency_contact_name && selected.driver_profile?.emergency_contact_phone) },
                      { label: "Licence captured", ok: Boolean(selected.driver_profile?.license_number && selected.driver_profile?.license_code && selected.driver_profile?.license_expiry) },
                      { label: "PDP / PrDP tracked", ok: true },
                      { label: "Vehicle captured", ok: Boolean(selected.vehicle_make || selected.vehicle_model) },
                      { label: "Registration captured", ok: Boolean(selected.vehicle_registration) },
                      { label: "Profile completed", ok: Boolean(selected.profile_completed) },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="flex items-center justify-between gap-3 rounded-2xl bg-white px-3 py-2 text-sm font-bold"
                      >
                        <span className="text-slate-700">{item.label}</span>
                        <span className={item.ok ? "text-emerald-700" : "text-amber-700"}>
                          {item.ok ? "Ready" : "Check"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {(selected.validation_issues?.length ?? 0) > 0 && (
                  <div className="rounded-3xl border border-slate-200 bg-white p-4">
                    <div className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">
                      Approval blockers and warnings
                    </div>
                    <div className="mt-3 space-y-2">
                      {selected.validation_issues?.slice(0, 12).map((item) => (
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
                  </div>
                )}

                {!selected.driver_profile?.pdp_number && (
                  <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
                    PDP missing - approval is still allowed under current MOOVU rules. MOOVU may request PDP / PrDP later.
                  </div>
                )}

                <div className="pt-2">
                  <div className="flex flex-wrap gap-3">
                    <Link href={`/admin/drivers/${selected.id}`} className="moovu-btn moovu-btn-secondary">
                      Open Driver Profile
                    </Link>
                    <button
                      type="button"
                      className="moovu-btn moovu-btn-primary"
                      disabled={busy}
                      onClick={() => setConfirmAction("approve")}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="moovu-btn moovu-btn-secondary text-amber-700"
                      disabled={busy}
                      onClick={() => setConfirmAction("suspend")}
                    >
                      Suspend
                    </button>
                    <button
                      type="button"
                      className="moovu-btn moovu-btn-secondary text-red-600"
                      disabled={busy}
                      onClick={() => setConfirmAction("delete")}
                    >
                      Delete application
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
