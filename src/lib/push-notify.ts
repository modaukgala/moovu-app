import { createClient } from "@supabase/supabase-js";
import { sendPushSafe } from "@/lib/push-server";

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function getTripNotificationTargets(tripId: string) {
  const supabase = getSupabaseAdmin();

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id,customer_auth_user_id,driver_id,pickup_address,dropoff_address")
    .eq("id", tripId)
    .maybeSingle();

  if (tripError) throw new Error(tripError.message);
  if (!trip) throw new Error("Trip not found.");

  let driverUserId: string | null = null;

  if (trip.driver_id) {
    const { data: driverAccount, error: driverError } = await supabase
      .from("driver_accounts")
      .select("user_id")
      .eq("driver_id", trip.driver_id)
      .maybeSingle();

    if (driverError) throw new Error(driverError.message);
    driverUserId = driverAccount?.user_id ?? null;
  }

  return {
    trip,
    customerUserId: trip.customer_auth_user_id ?? null,
    driverUserId,
  };
}

export async function notifyCustomerForTrip(
  tripId: string,
  title: string,
  body: string,
  url = "/book"
) {
  const { customerUserId } = await getTripNotificationTargets(tripId);
  if (!customerUserId) return null;

  return sendPushSafe({
    userIds: [customerUserId],
    role: "customer",
    title,
    body,
    url,
  });
}

export async function notifyDriverForTrip(
  tripId: string,
  title: string,
  body: string,
  url = "/driver"
) {
  const { driverUserId } = await getTripNotificationTargets(tripId);
  if (!driverUserId) return null;

  return sendPushSafe({
    userIds: [driverUserId],
    role: "driver",
    title,
    body,
    url,
  });
}

export async function notifyAdmins(
  title: string,
  body: string,
  url = "/admin"
) {
  return sendPushSafe({
    role: "admin",
    title,
    body,
    url,
  });
}
