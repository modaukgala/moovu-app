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
};

export default function AdminDriverApplicationsPage() {
  const [filter, setFilter] = useState("all");
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [selected, setSelected] = useState<ApplicationRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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

                <div className="pt-2">
                  <Link href={`/admin/drivers/${selected.id}`} className="moovu-btn moovu-btn-primary">
                    Open Driver Profile
                  </Link>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
