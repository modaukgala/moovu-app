"use client";

import { useEffect } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      await supabaseClient.auth.signOut();
      router.replace("/admin/login");
    })();
  }, [router]);

  return <p className="p-6">Signing out...</p>;
}