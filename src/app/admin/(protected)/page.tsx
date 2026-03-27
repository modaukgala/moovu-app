"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

type Profile = {
  full_name: string | null;
  role: string | null;
};

type DashboardCounts = {
  totalDrivers: number;
  pendingDrivers: number;
  activeDrivers: number;
  requestedTrips: number;
  assignedTrips: number;
  ongoingTrips: number;
  completedTrips: number;
  cancelledTrips: number;
};

export default function AdminPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [name, setName] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [counts, setCounts] = useState<DashboardCounts>({
    totalDrivers: 0,
    pendingDrivers: 0,
    activeDrivers: 0,
    requestedTrips: 0,
    assignedTrips: 0,
    ongoingTrips: 0,
    completedTrips: 0,
    cancelledTrips: 0,
  });

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabaseClient.auth.getUser();
      const user = userData.user;

      if (!user) {
        router.replace("/admin/login");
        return;
      }

      const { data: profile, error: profileError } = await supabaseClient
        .from("profiles")
        .select("full_name, role")
        .eq("id", user.id)
        .single();

      if (profileError || !profile) {
        router.replace("/admin/login?error=profile_missing");
        return;
      }

      const typedProfile = profile as Profile;
      const isStaff = ["owner", "admin", "dispatcher", "support"].includes(
        typedProfile.role ?? ""
      );

      if (!isStaff) {
        await supabaseClient.auth.signOut();
        router.replace("/admin/login?error=not_allowed");
        return;
      }

      setName(typedProfile.full_name ?? null);
      setRole(typedProfile.role ?? null);

      const [
        driversRes,
        requestedTripsRes,
        assignedTripsRes,
        ongoingTripsRes,
        completedTripsRes,
        cancelledTripsRes,
      ] = await Promise.all([
        supabaseClient.from("drivers").select("id, status"),
        supabaseClient.from("trips").select("id").eq("status", "requested"),
        supabaseClient.from("trips").select("id").eq("status", "assigned"),
        supabaseClient.from("trips").select("id").eq("status", "ongoing"),
        supabaseClient.from("trips").select("id").eq("status", "completed"),
        supabaseClient.from("trips").select("id").eq("status", "cancelled"),
      ]);

      const drivers = driversRes.data ?? [];
      const pendingDrivers = drivers.filter((d: any) => d.status === "pending").length;
      const activeDrivers = drivers.filter((d: any) =>
        ["approved", "active"].includes(d.status)
      ).length;

      setCounts({
        totalDrivers: drivers.length,
        pendingDrivers,
        activeDrivers,
        requestedTrips: requestedTripsRes.data?.length ?? 0,
        assignedTrips: assignedTripsRes.data?.length ?? 0,
        ongoingTrips: ongoingTripsRes.data?.length ?? 0,
        completedTrips: completedTripsRes.data?.length ?? 0,
        cancelledTrips: cancelledTripsRes.data?.length ?? 0,
      });

      setLoading(false);
    })();
  }, [router]);

  if (loading) {
    return <main className="p-6">Loading admin...</main>;
  }

  return (
    <main className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
        <p className="opacity-70 mt-2">
          Welcome{name ? `, ${name}` : ""} — role: {role}
        </p>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <div className="border rounded-2xl p-5">
          <div className="text-sm opacity-70">Total Drivers</div>
          <div className="text-2xl font-semibold mt-2">{counts.totalDrivers}</div>
        </div>

        <div className="border rounded-2xl p-5">
          <div className="text-sm opacity-70">Pending Drivers</div>
          <div className="text-2xl font-semibold mt-2">{counts.pendingDrivers}</div>
        </div>

        <div className="border rounded-2xl p-5">
          <div className="text-sm opacity-70">Active Drivers</div>
          <div className="text-2xl font-semibold mt-2">{counts.activeDrivers}</div>
        </div>

        <div className="border rounded-2xl p-5">
          <div className="text-sm opacity-70">Completed Trips</div>
          <div className="text-2xl font-semibold mt-2">{counts.completedTrips}</div>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <div className="border rounded-2xl p-5">
          <div className="text-sm opacity-70">Requested Trips</div>
          <div className="text-2xl font-semibold mt-2">{counts.requestedTrips}</div>
        </div>

        <div className="border rounded-2xl p-5">
          <div className="text-sm opacity-70">Assigned Trips</div>
          <div className="text-2xl font-semibold mt-2">{counts.assignedTrips}</div>
        </div>

        <div className="border rounded-2xl p-5">
          <div className="text-sm opacity-70">Ongoing Trips</div>
          <div className="text-2xl font-semibold mt-2">{counts.ongoingTrips}</div>
        </div>

        <div className="border rounded-2xl p-5">
          <div className="text-sm opacity-70">Cancelled Trips</div>
          <div className="text-2xl font-semibold mt-2">{counts.cancelledTrips}</div>
        </div>
      </div>

      <section className="border rounded-2xl p-5">
        <h2 className="font-semibold">Quick Actions</h2>

        <div className="flex flex-wrap gap-3 mt-4">
          <Link href="/admin/drivers" className="border rounded-xl px-4 py-2">
            Manage Drivers
          </Link>

          <Link href="/admin/drivers/new" className="border rounded-xl px-4 py-2">
            Add Driver
          </Link>

          <Link href="/admin/trips" className="border rounded-xl px-4 py-2">
            View Trips
          </Link>

          <Link href="/admin/trips/new" className="border rounded-xl px-4 py-2">
            Create Trip
          </Link>
        </div>
      </section>
    </main>
  );
}