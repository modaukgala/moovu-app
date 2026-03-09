"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseClient } from "@/lib/supabase/client";

type Driver = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  id_number: string | null;

  status: string | null; // e.g. pending/approved/active/etc.
  notes: string | null;

  online: boolean | null;
  lat: number | null;
  lng: number | null;
  last_seen: string | null;

  created_at: string | null;
};

export default function DriverProfilePage() {
  const params = useParams<{ id: string }>();
  const driverId = params.id;
  const router = useRouter();

  const [driver, setDriver] = useState<Driver | null>(null);
  const [loading, setLoading] = useState(true);

  // editable fields
  const [status, setStatus] = useState("");
  const [notes, setNotes] = useState("");

  // location by name
  const [locationName, setLocationName] = useState("");
  const [locBusy, setLocBusy] = useState(false);
  const [locInfo, setLocInfo] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function loadDriver() {
    setLoading(true);
    setErr(null);

    const { data, error } = await supabaseClient
      .from("drivers")
      .select(
        "id, first_name, last_name, phone, email, id_number, status, notes, online, lat, lng, last_seen, created_at"
      )
      .eq("id", driverId)
      .single();

    if (error || !data) {
      setDriver(null);
      setErr(error?.message ?? "Driver not found");
      setLoading(false);
      return;
    }

    const d = data as any as Driver;
    setDriver(d);

    setStatus(d.status ?? "");
    setNotes(d.notes ?? "");

    setLoading(false);
  }

  useEffect(() => {
    loadDriver();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId]);

  async function setOnline(online: boolean) {
    if (!driver) return;
    setSaving(true);
    setErr(null);

    const { error } = await supabaseClient
      .from("drivers")
      .update({
        online,
        last_seen: new Date().toISOString(),
      })
      .eq("id", driverId);

    setSaving(false);

    if (error) {
      setErr(error.message);
      return;
    }

    await loadDriver();
  }

  async function saveProfile() {
    if (!driver) return;
    setSaving(true);
    setErr(null);

    const { error } = await supabaseClient
      .from("drivers")
      .update({
        status: status || null,
        notes: notes || null,
      })
      .eq("id", driverId);

    setSaving(false);

    if (error) {
      setErr(error.message);
      return;
    }

    await loadDriver();
  }

  async function saveLocationFromName() {
    if (!driver) return;

    const place = locationName.trim();
    if (!place) {
      setLocInfo("Type a place name first (e.g. Siyabuswa C).");
      return;
    }

    setLocBusy(true);
    setLocInfo(null);
    setErr(null);

    try {
      const res = await fetch("/api/maps/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place }),
      });

      const json = await res.json();

      if (!json.ok) {
        setLocBusy(false);
        setLocInfo(json.error || "Location not found");
        return;
      }

      const { error } = await supabaseClient
        .from("drivers")
        .update({
          lat: json.lat,
          lng: json.lng,
          last_seen: new Date().toISOString(),
        })
        .eq("id", driverId);

      setLocBusy(false);

      if (error) {
        setErr(error.message);
        return;
      }

      setLocInfo(`Saved: ${json.address ?? place}`);
      await loadDriver();
    } catch (e: any) {
      setLocBusy(false);
      setErr(e?.message ?? "Failed to save location");
    }
  }

  if (loading) {
    return <main className="p-6">Loading driver...</main>;
  }

  if (!driver) {
    return (
      <main className="p-6">
        <p className="text-red-600">{err ?? "Driver not found"}</p>
        <button className="border rounded-xl px-4 py-2 mt-4" onClick={() => router.push("/admin/drivers")}>
          Back to Drivers
        </button>
      </main>
    );
  }

  return (
    <main className="p-6 space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {driver.first_name ?? "—"} {driver.last_name ?? ""}
          </h1>
          <p className="opacity-70 mt-1">Driver Profile</p>
        </div>

        <div className="flex gap-2">
          <Link className="border rounded-xl px-4 py-2" href="/admin/drivers">
            Back
          </Link>
        </div>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      {/* Basic info */}
      <section className="border rounded-2xl p-5 space-y-3">
        <h2 className="font-semibold">Details</h2>

        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="opacity-70">Phone</div>
            <div className="font-medium">{driver.phone ?? "—"}</div>
          </div>

          <div>
            <div className="opacity-70">Email</div>
            <div className="font-medium">{driver.email ?? "—"}</div>
          </div>

          <div>
            <div className="opacity-70">ID Number</div>
            <div className="font-medium">{driver.id_number ?? "—"}</div>
          </div>

          <div>
            <div className="opacity-70">Created</div>
            <div className="font-medium">
              {driver.created_at ? new Date(driver.created_at).toLocaleString() : "—"}
            </div>
          </div>
        </div>
      </section>

      {/* Status + notes */}
      <section className="border rounded-2xl p-5 space-y-4">
        <h2 className="font-semibold">Admin Settings</h2>

        <div className="grid md:grid-cols-2 gap-3">
          <input
            className="border rounded-xl p-3"
            placeholder="Status (e.g. approved, active)"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          />
          <button disabled={saving} className="border rounded-xl px-4 py-2" onClick={saveProfile}>
            {saving ? "Saving..." : "Save Profile"}
          </button>
        </div>

        <textarea
          className="border rounded-xl p-3 w-full min-h-[110px]"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </section>

      {/* Availability + Location */}
      <section className="border rounded-2xl p-5 space-y-4">
        <h2 className="font-semibold">Availability & Location</h2>

        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm opacity-70">
            Online: <span className="font-medium">{driver.online ? "Yes" : "No"}</span>
            {driver.last_seen ? ` • Last seen: ${new Date(driver.last_seen).toLocaleString()}` : ""}
          </div>

          <button disabled={saving} className="border rounded-xl px-4 py-2" onClick={() => setOnline(true)}>
            Set Online
          </button>
          <button disabled={saving} className="border rounded-xl px-4 py-2" onClick={() => setOnline(false)}>
            Set Offline
          </button>
        </div>

        <div className="text-sm opacity-70">
          Coords:{" "}
          <span className="font-medium">
            {driver.lat != null && driver.lng != null ? `${driver.lat}, ${driver.lng}` : "—"}
          </span>
        </div>

        {/* Location by place name */}
        <div className="grid md:grid-cols-2 gap-3">
          <input
            className="border rounded-xl p-3"
            placeholder="Type driver location (e.g. Siyabuswa C)"
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
          />
          <button
            type="button"
            className="border rounded-xl px-4 py-2"
            disabled={locBusy}
            onClick={saveLocationFromName}
          >
            {locBusy ? "Saving..." : "Save Location"}
          </button>
        </div>

        {locInfo && <p className="text-sm opacity-70">{locInfo}</p>}
      </section>
    </main>
  );
}