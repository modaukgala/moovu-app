import { supabaseAdmin } from "@/lib/supabase/admin";

export async function getUserFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) return null;
  return data?.user ?? null;
}

export async function getDriverIdForUser(userId: string): Promise<string | null> {
  const { data: mapping } = await supabaseAdmin
    .from("driver_accounts")
    .select("driver_id")
    .eq("user_id", userId)
    .single();

  return mapping?.driver_id ?? null;
}
