import { createClient } from "@supabase/supabase-js";

/** Resolves the signed-in driver from a bearer token, using the service client for reads. */
export async function requireDriver(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { ok: false as const, status: 401, error: "Unauthorized." };
  const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return { ok: false as const, status: 401, error: "Unauthorized." };
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: account, error: accountError } = await admin.from("driver_accounts")
    .select("driver_id").eq("user_id", user.id).maybeSingle();
  if (accountError || !account?.driver_id) {
    return { ok: false as const, status: 403, error: "Driver account is not linked." };
  }
  return { ok: true as const, admin, userId: user.id, driverId: account.driver_id as string };
}

export const NO_STORE = { "Cache-Control": "private, no-store" };
