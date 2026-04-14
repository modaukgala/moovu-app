import { createClient } from "@supabase/supabase-js";

export async function expireDriverSubscriptions() {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const nowIso = new Date().toISOString();

  const { data: drivers, error: fetchError } = await supabaseAdmin
    .from("drivers")
    .select(`
      id,
      subscription_status,
      subscription_expires_at,
      online,
      busy
    `)
    .eq("subscription_status", "active")
    .not("subscription_expires_at", "is", null)
    .lt("subscription_expires_at", nowIso);

  if (fetchError) {
    return {
      ok: false as const,
      error: fetchError.message,
      expiredCount: 0,
    };
  }

  const expiredDrivers = drivers ?? [];

  if (expiredDrivers.length === 0) {
    return {
      ok: true as const,
      expiredCount: 0,
    };
  }

  const driverIds = expiredDrivers.map((d: any) => d.id);

  const { error: updateError } = await supabaseAdmin
    .from("drivers")
    .update({
      subscription_status: "expired",
      online: false,
      busy: false,
      updated_at: nowIso,
    })
    .in("id", driverIds);

  if (updateError) {
    return {
      ok: false as const,
      error: updateError.message,
      expiredCount: 0,
    };
  }

  return {
    ok: true as const,
    expiredCount: driverIds.length,
    driverIds,
  };
}