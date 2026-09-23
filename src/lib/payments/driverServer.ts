import "server-only";

import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function getAuthenticatedDriver(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return { ok: false as const, status: 401, error: "Missing access token." };

  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return { ok: false as const, status: 401, error: "Unauthorized." };

  const { data: account, error: accountError } = await supabaseAdmin
    .from("driver_accounts")
    .select("driver_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (accountError || !account?.driver_id) {
    return { ok: false as const, status: 404, error: "Driver account is not linked." };
  }
  return { ok: true as const, user, driverId: String(account.driver_id), supabaseAdmin };
}
