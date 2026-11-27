import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPushSafe } from "@/lib/push-server";
export { findAwayDrivers, MISSED_OFFERS_BEFORE_OFFLINE } from "@/lib/dispatch/awayDriverPolicy";

/** Sets away drivers offline and tells them how to come back. Never throws. */
export async function setAwayDriversOffline(supabase: SupabaseClient, driverIds: string[]) {
  if (driverIds.length === 0) return;
  try {
    const { error } = await supabase.from("drivers").update({ online: false })
      .in("id", driverIds).eq("online", true);
    if (error) {
      console.warn("[dispatch] away drivers could not be set offline", { count: driverIds.length, code: error.code });
      return;
    }
    const { data: accounts } = await supabase.from("driver_accounts").select("user_id").in("driver_id", driverIds);
    const userIds = (accounts ?? []).map((row) => row.user_id).filter(Boolean) as string[];
    console.info("[dispatch] away drivers set offline", { count: driverIds.length });
    if (userIds.length) {
      await sendPushSafe({
        userIds, role: "driver",
        title: "You've been set offline",
        body: "You missed your last trip offers. Open MOOVU and go online when you're ready for trips.",
        url: "/driver",
      }).catch(() => null);
    }
  } catch {
    console.warn("[dispatch] away driver check failed");
  }
}
