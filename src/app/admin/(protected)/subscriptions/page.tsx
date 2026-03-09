"use client";

import { useEffect, useMemo, useState } from "react";

type DriverRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  online: boolean | null;
  busy: boolean | null;
  subscription_status: string | null;
  subscription_expires_at: string | null;
  subscription_plan: string | null;
  created_at: string | null;
};

type SubEvent = {
  id: string;
  action: string;
  old_status: string | null;
  new_status: string | null;
  old_expires_at: string | null;
  new_expires_at: string | null;
  note: string | null;
  created_at: string;
  actor: string | null;
};

export default function AdminSubscriptionsPage() {
  const [q, setQ] = useState("");
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [selected, setSelected] = useState<DriverRow | null>(null);

  const [history, setHistory] = useState<SubEvent[]>([]);
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadDrivers() {
    setMsg(null);
    const res = await fetch(`/api/admin/subscriptions/drivers?q=${encodeURIComponent(q)}`);
    const json = await res.json();
    if (!json.ok) {
      setDrivers([]);
      setMsg(json.error || "Failed to load drivers");
      return;
    }
    setDrivers(json.drivers ?? []);
  }

  async function loadHistory(driverId: string) {
    const res = await fetch(`/api/admin/subscriptions/history?driverId=${encodeURIComponent(driverId)}`);
    const json = await res.json();
    if (json.ok) setHistory(json.events ?? []);
    else setHistory([]);
  }

  useEffect(() => {
    loadDrivers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedLabel = useMemo(() => {
    if (!selected) return "";
    const name = `${selected.first_name ?? ""} ${selected.last_name ?? ""}`.trim() || "Unnamed";
    const exp = selected.subscription_expires_at
      ? new Date(selected.subscription_expires_at).toLocaleString()
      : "—";
    return `${name} • ${selected.phone ?? "—"} • ${selected.subscription_status ?? "—"} • exp: ${exp}`;
  }, [selected]);

  async function act(action: string, days?: number) {
    if (!selected) return;

    setBusy(true);
    setMsg(null);

    const res = await fetch("/api/admin/subscriptions/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        driverId: selected.id,
        action,
        days: days ?? null,
        note: note || null,
        plan: plan || null,
      }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setMsg(json.error || "Update failed");
      return;
    }

    setMsg("✅ Subscription updated");
    await loadDrivers();
    await loadHistory(selected.id);

    // Refresh selected data from list
    const updated = drivers.find((d) => d.id === selected.id);
    if (updated) setSelected(updated);
  }

  return (
    <main className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Subscription Manager</h1>
          <p className="opacity-70 mt-1">Only subscribed + online drivers can receive trip offers.</p>
        </div>

        <div className="flex gap-2">
          <input
            className="border rounded-xl px-4 py-2"
            placeholder="Search driver (name/phone/email)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="border rounded-xl px-4 py-2" onClick={loadDrivers}>
            Search
          </button>
        </div>
      </div>

      {msg && <div className="border rounded-2xl p-4 text-sm">{msg}</div>}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Drivers list */}
        <section className="border rounded-2xl p-5">
          <h2 className="font-semibold">Drivers ({drivers.length})</h2>

          <div className="mt-4 space-y-3">
            {drivers.map((d) => {
              const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Unnamed";
              const exp = d.subscription_expires_at ? new Date(d.subscription_expires_at).toLocaleDateString() : "—";
              return (
                <button
                  key={d.id}
                  className={`w-full text-left border rounded-2xl p-4 hover:opacity-90 ${
                    selected?.id === d.id ? "opacity-100" : "opacity-85"
                  }`}
                  onClick={async () => {
                    setSelected(d);
                    setPlan(d.subscription_plan ?? "");
                    setNote("");
                    setMsg(null);
                    await loadHistory(d.id);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{name}</div>
                    <div className="text-xs opacity-60">{d.phone ?? "—"}</div>
                  </div>
                  <div className="text-sm opacity-70 mt-1">
                    {d.subscription_status ?? "—"} • exp: {exp} • online: {d.online ? "yes" : "no"} • busy:{" "}
                    {d.busy ? "yes" : "no"}
                  </div>
                  <div className="text-xs opacity-60 mt-1">{d.id}</div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Editor */}
        <section className="border rounded-2xl p-5">
          <h2 className="font-semibold">Edit Subscription</h2>

          {!selected ? (
            <p className="opacity-70 mt-3">Select a driver.</p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="border rounded-2xl p-4">
                <div className="text-sm opacity-70">Selected driver</div>
                <div className="font-medium mt-1">{selectedLabel}</div>
                <div className="text-xs opacity-60 mt-2">{selected.id}</div>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <input
                  className="border rounded-xl p-3"
                  placeholder="Plan (optional) e.g. Monthly"
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                />
                <input
                  className="border rounded-xl p-3"
                  placeholder="Note (receipt/ref/etc)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => act("activate")}>
                  Activate
                </button>
                <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => act("inactive")}>
                  Set Inactive
                </button>
                <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => act("grace")}>
                  Grace
                </button>
                <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => act("suspend")}>
                  Suspend
                </button>
              </div>

              <div className="border rounded-2xl p-4 space-y-2">
                <div className="font-semibold">Extend</div>
                <div className="flex flex-wrap gap-2">
                  <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => act("extend", 7)}>
                    +1 day
                  </button>
                  <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => act("extend", 30)}>
                    +7 days
                  </button>
                  <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => act("extend", 90)}>
                    +30 days
                  </button>
                </div>
                <div className="text-xs opacity-60">Extend makes subscription active and moves expiry forward.</div>
              </div>

              <div className="border rounded-2xl p-4">
                <div className="font-semibold">History</div>
                {history.length === 0 ? (
                  <p className="opacity-70 mt-2">No changes logged yet.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {history.map((h) => (
                      <div key={h.id} className="border rounded-xl p-3">
                        <div className="text-sm">
                          <span className="font-medium">{h.action}</span>{" "}
                          <span className="opacity-70">
                            ({h.old_status ?? "—"} → {h.new_status ?? "—"})
                          </span>
                        </div>
                        <div className="text-xs opacity-60 mt-1">
                          exp: {h.old_expires_at ? new Date(h.old_expires_at).toLocaleString() : "—"} →{" "}
                          {h.new_expires_at ? new Date(h.new_expires_at).toLocaleString() : "—"}
                        </div>
                        {h.note && <div className="text-xs opacity-70 mt-1">note: {h.note}</div>}
                        <div className="text-xs opacity-60 mt-1">{new Date(h.created_at).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}