"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";

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

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    return session?.access_token ?? null;
  }

  async function loadDrivers() {
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setDrivers([]);
      setMsg("You are not logged in.");
      return;
    }

    const res = await fetch(
      `/api/admin/subscriptions/drivers?q=${encodeURIComponent(q)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      }
    );

    const json = await res.json();
    if (!json.ok) {
      setDrivers([]);
      setMsg(json.error || "Failed to load drivers");
      return;
    }

    setDrivers(json.drivers ?? []);
  }

  async function loadHistory(driverId: string) {
    const token = await getAccessToken();
    if (!token) {
      setHistory([]);
      setMsg("You are not logged in.");
      return;
    }

    const res = await fetch(
      `/api/admin/subscriptions/history?driverId=${encodeURIComponent(driverId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      }
    );

    const json = await res.json();
    if (json.ok) setHistory(json.events ?? []);
    else {
      setHistory([]);
      setMsg(json.error || "Failed to load subscription history");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDrivers();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const selectedLabel = useMemo(() => {
    if (!selected) return "";
    const name = `${selected.first_name ?? ""} ${selected.last_name ?? ""}`.trim() || "Unnamed";
    const exp = selected.subscription_expires_at
      ? new Date(selected.subscription_expires_at).toLocaleString()
      : "--";
    return `${name} - ${selected.phone ?? "--"} - ${selected.subscription_status ?? "--"} - exp: ${exp}`;
  }, [selected]);

  async function act(action: string, days?: number) {
    if (!selected) return;

    setBusy(true);
    setMsg(null);

    const token = await getAccessToken();
    if (!token) {
      setBusy(false);
      setMsg("You are not logged in.");
      return;
    }

    const res = await fetch("/api/admin/subscriptions/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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

    setMsg("Subscription updated.");
    await loadDrivers();
    await loadHistory(selected.id);

    setSelected((prev) => {
      if (!prev) return prev;
      const updated = drivers.find((d) => d.id === prev.id);
      return updated ?? prev;
    });
  }

  return (
    <main className="p-6 space-y-6">
      <div className="moovu-card p-5 sm:p-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="moovu-section-title">MOOVU Admin</div>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Subscription manager</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Only subscribed and online drivers can receive trip offers.
          </p>
        </div>

        <div className="flex gap-2">
          <input
            className="border rounded-xl px-4 py-2"
            placeholder="Search driver"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="border rounded-xl px-4 py-2" onClick={loadDrivers}>
            Search
          </button>
        </div>
      </div>

      {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

      <div className="grid lg:grid-cols-2 gap-6">
        <section className="border rounded-2xl p-5">
          <h2 className="font-semibold">Drivers ({drivers.length})</h2>

          <div className="mt-4 space-y-3">
            {drivers.map((d) => {
              const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Unnamed";
              const exp = d.subscription_expires_at
                ? new Date(d.subscription_expires_at).toLocaleDateString()
                : "--";

              return (
                <button
                  key={d.id}
                  className={`w-full text-left border rounded-2xl p-4 hover:opacity-90 ${
                    selected?.id === d.id ? "bg-black text-white" : ""
                  }`}
                  onClick={() => {
                    setSelected(d);
                    loadHistory(d.id);
                    setPlan(d.subscription_plan ?? "");
                  }}
                >
                  <div className="font-medium">{name}</div>
                  <div className="text-sm opacity-75 mt-1">{d.phone ?? "--"}</div>
                  <div className="text-sm opacity-75 mt-1">
                    {d.subscription_status ?? "inactive"} - plan: {d.subscription_plan ?? "--"} - exp: {exp}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="border rounded-2xl p-5">
          <h2 className="font-semibold">Selected Driver</h2>

          {!selected ? (
            <p className="opacity-70 mt-4">Choose a driver from the list.</p>
          ) : (
            <div className="space-y-5 mt-4">
              <div className="border rounded-2xl p-4">
                <div className="font-medium">{selectedLabel}</div>
                <div className="text-sm opacity-70 mt-2">Driver ID: {selected.id}</div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <input
                  className="border rounded-xl p-3"
                  placeholder="Optional note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />

                <select
                  className="border rounded-xl p-3 bg-transparent"
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                >
                  <option value="">Keep existing plan</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>

              <div className="flex flex-wrap gap-2">
                <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => act("activate")}>
                  Activate
                </button>
                <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => act("grace")}>
                  Grace
                </button>
                <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => act("suspend")}>
                  Suspend
                </button>
                <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => act("inactive")}>
                  Set Inactive
                </button>
                <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => act("extend", 1)}>
                  +1 day
                </button>
                <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => act("extend", 7)}>
                  +7 days
                </button>
                <button className="border rounded-xl px-4 py-2" disabled={busy} onClick={() => act("extend", 30)}>
                  +30 days
                </button>
              </div>

              <div className="border rounded-2xl p-4">
                <h3 className="font-medium">History</h3>

                {history.length === 0 ? (
                  <p className="opacity-70 mt-3">No subscription history yet.</p>
                ) : (
                  <div className="space-y-3 mt-3">
                    {history.map((h) => (
                      <div key={h.id} className="border rounded-xl p-3">
                        <div className="font-medium">{h.action}</div>
                        <div className="text-sm opacity-70 mt-1">
                          <span>
                            ({h.old_status ?? "--"} to {h.new_status ?? "--"})
                          </span>
                        </div>
                        <div className="text-xs opacity-60 mt-1">
                          exp: {h.old_expires_at ? new Date(h.old_expires_at).toLocaleString() : "--"} to{" "}
                          {h.new_expires_at ? new Date(h.new_expires_at).toLocaleString() : "--"}
                        </div>
                        {h.note && <div className="text-xs opacity-70 mt-1">note: {h.note}</div>}
                        <div className="text-xs opacity-60 mt-1">
                          {new Date(h.created_at).toLocaleString()}
                        </div>
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
