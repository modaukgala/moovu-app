"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseClient } from "@/lib/supabase/client";

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
  const [filter, setFilter] = useState("pending");
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [selected, setSelected] = useState<ApplicationRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token ?? null;
  }

  async function loadApplications(nextFilter?: string) {
    setBusy(true);
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setBusy(false);
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
      setBusy(false);
      setMsg(json?.error || "Failed to load applications.");
      return;
    }

    const rows = (json.applications ?? []) as ApplicationRow[];
    setApplications(rows);
    setSelected(rows[0] ?? null);
    setBusy(false);
  }

  useEffect(() => {
    loadApplications();
  }, []);

  const selectedVehicle = useMemo(() => {
    if (!selected) return "—";
    return [selected.vehicle_make, selected.vehicle_model]
      .filter(Boolean)
      .join(" ") || "—";
  }, [selected]);

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <div className="text-sm text-gray-500">Driver Onboarding</div>
          <h1 className="text-4xl font-semibold mt-1">Driver Applications</h1>
          <p className="text-gray-700 mt-2">
            Approve, link, review profile details, inspect documents and notify applicants.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            className="border rounded-xl px-4 py-3 bg-white"
            value={filter}
            onChange={(e) => {
              const value = e.target.value;
              setFilter(value);
              loadApplications(value);
            }}
          >
            <option value="pending">Pending</option>
            <option value="pending_review">Pending Review</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>

          <button
            className="rounded-xl px-5 py-3 text-white"
            style={{ background: "var(--moovu-primary)" }}
            disabled={busy}
            onClick={() => loadApplications()}
          >
            {busy ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {msg && (
          <div className="border rounded-2xl p-4 text-sm bg-white">
            {msg}
          </div>
        )}

        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-6">
          <section className="border rounded-[2rem] p-6 bg-white shadow-sm">
            <div className="text-sm text-gray-500">Applications Queue</div>
            <h2 className="text-3xl font-semibold mt-1">
              Applications ({applications.length})
            </h2>

            <div className="mt-5 space-y-3">
              {applications.length === 0 ? (
                <div className="text-gray-600">No applications found.</div>
              ) : (
                applications.map((app) => {
                  const name =
                    `${app.first_name ?? ""} ${app.last_name ?? ""}`.trim() || "Unnamed";
                  return (
                    <button
                      key={app.id}
                      className={`w-full text-left border rounded-2xl p-4 transition ${
                        selected?.id === app.id ? "bg-black text-white" : "bg-white"
                      }`}
                      onClick={() => setSelected(app)}
                    >
                      <div className="font-semibold">{name}</div>
                      <div className="text-sm opacity-80 mt-1">{app.phone ?? "—"}</div>
                      <div className="text-sm opacity-80 mt-1">
                        status: {app.status ?? "—"} • verification: {app.verification_status ?? "—"}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="border rounded-[2rem] p-6 bg-white shadow-sm">
            <div className="text-sm text-gray-500">Application Review</div>
            <h2 className="text-3xl font-semibold mt-1">Details</h2>

            {!selected ? (
              <div className="mt-5 text-gray-600">Select an application.</div>
            ) : (
              <div className="mt-5 space-y-5">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-gray-500">Applicant</div>
                    <div className="text-xl font-medium mt-1">
                      {selected.first_name ?? "—"} {selected.last_name ?? ""}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm text-gray-500">Phone</div>
                    <div className="text-xl font-medium mt-1">{selected.phone ?? "—"}</div>
                  </div>

                  <div>
                    <div className="text-sm text-gray-500">Email</div>
                    <div className="text-xl font-medium mt-1">{selected.email ?? "—"}</div>
                  </div>

                  <div>
                    <div className="text-sm text-gray-500">Verification</div>
                    <div className="text-xl font-medium mt-1">{selected.verification_status ?? "—"}</div>
                  </div>

                  <div>
                    <div className="text-sm text-gray-500">Vehicle</div>
                    <div className="text-xl font-medium mt-1">{selectedVehicle}</div>
                  </div>

                  <div>
                    <div className="text-sm text-gray-500">Registration</div>
                    <div className="text-xl font-medium mt-1">{selected.vehicle_registration ?? "—"}</div>
                  </div>

                  <div>
                    <div className="text-sm text-gray-500">Vehicle Details</div>
                    <div className="text-xl font-medium mt-1">
                      {[selected.vehicle_year, selected.vehicle_color].filter(Boolean).join(" • ") || "—"}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm text-gray-500">Created</div>
                    <div className="text-xl font-medium mt-1">
                      {selected.created_at ? new Date(selected.created_at).toLocaleString() : "—"}
                    </div>
                  </div>
                </div>

                <div className="pt-2">
                  <Link
                    href={`/admin/drivers/${selected.id}`}
                    className="inline-flex rounded-xl px-5 py-3 text-white"
                    style={{ background: "var(--moovu-primary)" }}
                  >
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