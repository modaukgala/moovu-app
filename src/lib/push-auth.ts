import type { SupabaseClient } from "@supabase/supabase-js";
import { ALLOWED_ADMIN_ROLES } from "@/lib/auth/admin";

export type PushRole = "admin" | "driver" | "customer";

export const PUSH_ROLES: PushRole[] = ["admin", "driver", "customer"];

export function isPushRole(value: unknown): value is PushRole {
  return typeof value === "string" && PUSH_ROLES.includes(value as PushRole);
}

type RoleAccessResult =
  | { ok: true }
  | { ok: false; status: 403; error: string };

export async function verifyPushRoleAccess(
  supabase: SupabaseClient,
  userId: string,
  role: PushRole,
): Promise<RoleAccessResult> {
  if (role === "admin") {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (error || !profile?.role || !ALLOWED_ADMIN_ROLES.includes(profile.role)) {
      return { ok: false, status: 403, error: "Admin notification access required." };
    }

    return { ok: true };
  }

  if (role === "driver") {
    const { data: driverAccount, error } = await supabase
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !driverAccount?.driver_id) {
      return { ok: false, status: 403, error: "Driver notification access required." };
    }

    return { ok: true };
  }

  const { data: customer, error } = await supabase
    .from("customers")
    .select("id")
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (error || !customer?.id) {
    return { ok: false, status: 403, error: "Customer notification access required." };
  }

  return { ok: true };
}
