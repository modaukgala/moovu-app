"use client";

import { useEffect, useMemo, useState } from "react";
import { waLinkZA } from "@/lib/whatsapp";

type Application = {
  id: string;
  user_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  linked_driver_id: string | null;
};

type DriverOpt = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: string | null;
  online: boolean | null;
  busy: boolean | null;
  created_at: string | null;
};

export default function AdminApplicationsPage() {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [apps, setApps] = useState<Application[]>([]);
  const [drivers, setDrivers] = useState<DriverOpt[]>([]);

  const [selected, setSelected] = useState<Application | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadApplications() {
    setMsg(null);
    const qs = status === "all" ? "" : `?status=${status}`;
    const res = await fetch(`/api/admin/applications${qs}`);
    const json = await res.json();
    if (!json.ok) {
      setApps([]);
      setMsg(json.error || "Failed to load applications");
      return;
    }
    setApps(json.applications ?? []);
  }

  async function loadDrivers() {
    const res = await fetch("/api/admin/drivers/options");
    const json = await res.json();
    if (json.ok) setDrivers(json.drivers ?? []);
  }

  useEffect(() => {
    loadDrivers();
  }, []);

  useEffect(() => {
    loadApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const selectedDriverLabel = useMemo(() => {
    const d = drivers.find((x) => x.id === selectedDriverId);
    if (!d) return null;
    const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Unnamed";
    return `${name} • ${d.phone ?? "—"} • ${d.status ?? "—"}`;
  }, [drivers, selectedDriverId]);

  async function doAction(action: "approve" | "reject" | "link" | "unlink") {
    if (!selected) return;

    setBusy(true);
    setMsg(null);

    const payload: any = { action, applicationId: selected.id, userId: selected.user_id };
    if (action === "link") payload.driverId = selectedDriverId;

    const res = await fetch("/api/admin/applications/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setMsg(json.error || "Action failed");
      return;
    }

    setMsg(`✅ ${json.message}`);
    await loadApplications();
  }

  async function createDriverFromApplication() {
    if (!selected) return;

    setBusy(true);
    setMsg(null);

    const res = await fetch("/api/admin/applications/create-driver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: selected.id }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setMsg(json.error || "Create driver failed");
      return;
    }

    setMsg(`✅ ${json.message} (Driver UUID: ${json.driverId ?? "—"})`);
    await loadDrivers();
    await loadApplications();
  }

  const waHref = useMemo(() => {
    if (!selected?.phone) return null;
    const message = selected.linked_driver_id
      ? `Hi ${selected.full_name ?? ""}. Your MOOVU driver account is approved and linked. You can now login at https://moovurides.co.za/driver/login`
      : `Hi ${selected.full_name ?? ""}. Your MOOVU driver application is received. We will approve and link your account soon.`;
    return waLinkZA(selected.phone, message);
  }, [selected]);

  return (
    <main className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Driver Applications</h1>
          <p className="opacity-70 mt-1">Approve/reject, link, and notify via WhatsApp.</p>
        </div>

        <div className="flex gap-2">
          <select
            className="border rounded-xl px-4 py-2 bg-transparent"
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>

          <button className="border rounded-xl px-4 py-2" onClick={loadApplications}>
            Refresh
          </button>
        </div>
      </div>

      {msg && <div className="border rounded-2xl p-4 text-sm">{msg}</div>}

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="border rounded-2xl p-5">
          <h2 className="font-semibold">Applications ({apps.length})</h2>

          {apps.length === 0 ? (
            <p className="opacity-70 mt-3">No applications found.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {apps.map((a) => {
                const linked = !!a.linked_driver_id;
                return (
                  <button
                    key={a.id}
                    onClick={() => {
                      setSelected(a);
                      setSelectedDriverId("");
                      setMsg(null);
                    }}
                    className={`w-full text-left border rounded-2xl p-4 hover:opacity-90 ${
                      selected?.id === a.id ? "opacity-100" : "opacity-85"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">{a.full_name ?? "Unnamed driver"}</div>
                      <div className="text-xs opacity-60">{new Date(a.created_at).toLocaleString()}</div>
                    </div>

                    <div className="text-sm opacity-70 mt-1">
                      {a.email ?? "—"} • {a.phone ?? "—"} • <span className="capitalize">{a.status}</span>
                    </div>

                    <div className="text-xs mt-2 opacity-70">
                      Link:{" "}
                      <span className="font-medium">
                        {linked ? `Linked ✅ (${a.linked_driver_id})` : "Not linked"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="border rounded-2xl p-5">
          <h2 className="font-semibold">Details</h2>

          {!selected ? (
            <p className="opacity-70 mt-3">Select an application.</p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="border rounded-2xl p-4 space-y-2">
                <div className="text-sm opacity-70">Full name</div>
                <div className="font-medium">{selected.full_name ?? "—"}</div>

                <div className="text-sm opacity-70 mt-3">Email</div>
                <div className="font-medium">{selected.email ?? "—"}</div>

                <div className="text-sm opacity-70 mt-3">Phone</div>
                <div className="font-medium">{selected.phone ?? "—"}</div>

                <div className="text-sm opacity-70 mt-3">Status</div>
                <div className="font-medium capitalize">{selected.status}</div>

                <div className="text-sm opacity-70 mt-3">Link status</div>
                <div className="font-medium">
                  {selected.linked_driver_id ? `Linked ✅ (${selected.linked_driver_id})` : "Not linked"}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => doAction("approve")}>
                  Approve
                </button>
                <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => doAction("reject")}>
                  Reject
                </button>
                <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => doAction("unlink")}>
                  Unlink
                </button>

                {waHref ? (
                  <a className="border rounded-xl px-4 py-2" href={waHref} target="_blank" rel="noreferrer">
                    WhatsApp Notify
                  </a>
                ) : (
                  <button className="border rounded-xl px-4 py-2 opacity-50" disabled>
                    WhatsApp Notify
                  </button>
                )}
              </div>

              <div className="border rounded-2xl p-4 space-y-3">
                <div className="font-semibold">Create Driver Profile (fast)</div>
                <p className="text-sm opacity-70">
                  Creates driver, links account, and approves application.
                </p>
                <button
                  className="border rounded-xl px-4 py-2"
                  disabled={busy || !!selected.linked_driver_id}
                  onClick={createDriverFromApplication}
                >
                  Create Driver + Link + Approve
                </button>
              </div>

              <div className="border rounded-2xl p-4 space-y-3">
                <div className="font-semibold">Manual Link to Driver UUID</div>

                <select
                  className="border rounded-xl p-3 bg-transparent w-full"
                  value={selectedDriverId}
                  onChange={(e) => setSelectedDriverId(e.target.value)}
                >
                  <option value="">Select driver...</option>
                  {drivers.map((d) => {
                    const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Unnamed";
                    return (
                      <option key={d.id} value={d.id}>
                        {name} • {d.phone ?? "—"} • {d.id}
                      </option>
                    );
                  })}
                </select>

                {selectedDriverLabel && <div className="text-sm opacity-70">Selected: {selectedDriverLabel}</div>}

                <button
                  className="border rounded-xl px-4 py-2"
                  disabled={busy || !selectedDriverId}
                  onClick={() => doAction("link")}
                >
                  Link (and approve)
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}