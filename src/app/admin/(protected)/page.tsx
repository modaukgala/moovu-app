"use client";

import { useEffect, useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function AdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabaseClient.auth.getUser();
      const user = userData.user;

      if (!user) {
        router.replace("/admin/login");
        return;
      }

      const { data: profile, error } = await supabaseClient
        .from("profiles")
        .select("full_name, role")
        .eq("id", user.id)
        .single();

      if (error || !profile) {
        router.replace("/admin/login?error=profile_missing");
        return;
      }

      const isStaff = ["owner", "admin", "dispatcher", "support"].includes(profile.role);

      if (!isStaff) {
        await supabaseClient.auth.signOut();
        router.replace("/admin/login?error=not_allowed");
        return;
      }

      setName(profile.full_name ?? null);
      setRole(profile.role);
      setLoading(false);
    })();
  }, [router]);

  if (loading) return <main className="p-6">Loading admin...</main>;

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
      <p className="opacity-70 mt-2">
        Welcome{name ? `, ${name}` : ""} — role: {role}
      </p>
    </main>
  );
}