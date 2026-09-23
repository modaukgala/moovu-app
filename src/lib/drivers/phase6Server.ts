import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromBearer, getDriverIdForUser } from "@/app/api/driver/utils";
import { requireAdminUser, isFinancialAdminRole } from "@/lib/auth/admin";
import type { Phase6Application } from "./phase6Policy";

export async function phase6Auth(req: Request, admin = false) {
  if (admin) { const auth = await requireAdminUser(req); return auth.ok && isFinancialAdminRole(auth.profile.role) ? auth.user : null; }
  return getUserFromBearer(req);
}
export async function phase6Owned(req: Request, id: string, admin = false) {
  const user = await phase6Auth(req, admin);
  if (!user) return null;
  let query = supabaseAdmin.from("phase6_applications").select("*").eq("id", id);
  if (!admin) {
    const driverId = await getDriverIdForUser(user.id);
    if (!driverId) return null;
    const profile = await supabaseAdmin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profile.error || profile.data && profile.data.role !== "driver") return null;
    const enrollment = await supabaseAdmin.from("phase6_enrollments").select("driver_id").eq("user_id", user.id).eq("driver_id", driverId).maybeSingle();
    if (!enrollment.data) return null;
    const driver = await supabaseAdmin.from("drivers").select("is_deleted").eq("id", driverId).maybeSingle();
    if (driver.error || !driver.data || driver.data.is_deleted) return null;
    query = query.eq("driver_id", driverId);
  }
  const { data, error } = await query.maybeSingle();
  return !error && data ? { user, application: data as Phase6Application } : null;
}
export async function phase6Active() {
  const result = await supabaseAdmin.from("phase6_policy").select("active").eq("singleton", true).maybeSingle();
  if (result.error || !result.data) throw new Error("Onboarding policy is unavailable.");
  return result.data.active === true;
}
