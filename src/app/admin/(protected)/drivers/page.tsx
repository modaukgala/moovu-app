"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";

type Driver = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  status: string;
};

export default function DriversPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDrivers = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabaseClient
      .from("drivers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setDrivers([]);
      setLoading(false);
      return;
    }

    setDrivers((data ?? []) as Driver[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadDrivers();
  }, [loadDrivers]);

  async function updateStatus(id: string, status: string) {
    await supabaseClient.from("drivers").update({ status }).eq("id", id);
    await loadDrivers();
  }

  if (loading) {
    return <div className="p-6">Loading drivers...</div>;
  }

  return (
    <main className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Drivers</h1>

        <Link href="/admin/drivers/new" className="border rounded-xl px-4 py-2">
          + Add Driver
        </Link>
      </div>

      <table className="w-full border rounded-xl overflow-hidden">
        <thead className="bg-gray-100">
          <tr>
            <th className="p-3 text-left">Name</th>
            <th className="p-3 text-left">Phone</th>
            <th className="p-3 text-left">Email</th>
            <th className="p-3 text-left">Status</th>
            <th className="p-3 text-left">Actions</th>
          </tr>
        </thead>

        <tbody>
          {drivers.map((d) => (
            <tr key={d.id} className="border-t">
              <td className="p-3">
                <Link
                  className="underline underline-offset-4 hover:opacity-80"
                  href={`/admin/drivers/${d.id}`}
                >
                  {d.first_name} {d.last_name}
                </Link>
              </td>

              <td className="p-3">{d.phone}</td>
              <td className="p-3">{d.email}</td>
              <td className="p-3 capitalize">{d.status}</td>

              <td className="p-3 space-x-2">
                {d.status === "pending" && (
                  <button
                    onClick={() => void updateStatus(d.id, "approved")}
                    className="border px-3 py-1 rounded"
                  >
                    Approve
                  </button>
                )}

                {d.status !== "suspended" && (
                  <button
                    onClick={() => void updateStatus(d.id, "suspended")}
                    className="border px-3 py-1 rounded"
                  >
                    Suspend
                  </button>
                )}

                {d.status === "suspended" && (
                  <button
                    onClick={() => void updateStatus(d.id, "active")}
                    className="border px-3 py-1 rounded"
                  >
                    Activate
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}