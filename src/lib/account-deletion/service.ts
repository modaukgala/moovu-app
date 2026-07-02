import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type DeleteResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

const CUSTOMER_ACTIVE_TRIP_STATUSES = ["requested", "offered", "assigned", "arrived", "ongoing"];
const DRIVER_ACTIVE_TRIP_STATUSES = ["assigned", "arrived", "ongoing"];

function isMissingSchema(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    error?.code === "PGRST205" ||
    error?.code === "42703" ||
    message.includes("could not find the table") ||
    (message.includes("relation") && message.includes("does not exist")) ||
    (message.includes("column") && message.includes("does not exist"))
  );
}

function logNonCritical(label: string, error: { message?: string } | null | undefined) {
  if (!error || isMissingSchema(error)) return;
  console.error(`[account-deletion] ${label}`, error.message);
}

function createPasswordVerifier() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}

async function verifyPassword(params: {
  email: string | null | undefined;
  password: string;
}) {
  if (!params.email || !params.password) return false;

  const verifier = createPasswordVerifier();
  const { error } = await verifier.auth.signInWithPassword({
    email: params.email,
    password: params.password,
  });

  await verifier.auth.signOut().catch(() => {});
  return !error;
}

async function safeDeleteByUserId(supabase: SupabaseClient, table: string, userId: string) {
  const { error } = await supabase.from(table).delete().eq("user_id", userId);
  logNonCritical(`${table} cleanup failed`, error);
}

async function safeDeleteByDriverId(supabase: SupabaseClient, table: string, driverId: string) {
  const { error } = await supabase.from(table).delete().eq("driver_id", driverId);
  logNonCritical(`${table} cleanup failed`, error);
}

async function cleanupCommonUserData(supabase: SupabaseClient, userId: string) {
  await safeDeleteByUserId(supabase, "fcm_tokens", userId);
  await safeDeleteByUserId(supabase, "push_subscriptions", userId);
  await safeDeleteByUserId(supabase, "app_notifications", userId);

  const { error: messageError } = await supabase
    .from("trip_messages")
    .delete()
    .eq("sender_user_id", userId);
  logNonCritical("trip_messages cleanup failed", messageError);
}

async function hasActiveCustomerTrip(supabase: SupabaseClient, customerId: string) {
  const { data, error } = await supabase
    .from("trips")
    .select("id,status")
    .eq("customer_id", customerId)
    .in("status", CUSTOMER_ACTIVE_TRIP_STATUSES)
    .limit(1);

  if (error) return { ok: false as const, error };
  return { ok: true as const, active: (data ?? []).length > 0 };
}

async function hasActiveDriverTrip(supabase: SupabaseClient, driverId: string) {
  const { data, error } = await supabase
    .from("trips")
    .select("id,status")
    .eq("driver_id", driverId)
    .in("status", DRIVER_ACTIVE_TRIP_STATUSES)
    .limit(1);

  if (error) return { ok: false as const, error };
  return { ok: true as const, active: (data ?? []).length > 0 };
}

async function anonymizeCustomerProfile(params: {
  supabase: SupabaseClient;
  customerId: string;
  userId: string;
  reason: string | null;
  now: string;
}) {
  const payload = {
    auth_user_id: null,
    first_name: "Deleted",
    last_name: "Customer",
    email: null,
    phone: null,
    normalized_phone: null,
    status: "deleted",
    deletion_requested_at: params.now,
    deletion_status: "completed",
    deleted_at: params.now,
    anonymized_at: params.now,
    deletion_reason: params.reason,
    updated_at: params.now,
  };

  const { error } = await params.supabase
    .from("customers")
    .update(payload)
    .eq("id", params.customerId);

  if (!error) return;

  logNonCritical("full customer anonymization failed", error);

  const fallback = {
    first_name: "Deleted",
    last_name: "Customer",
    phone: null,
    normalized_phone: null,
    status: "inactive",
  };
  const { error: fallbackError } = await params.supabase
    .from("customers")
    .update(fallback)
    .eq("id", params.customerId);
  logNonCritical("fallback customer anonymization failed", fallbackError);
}

async function anonymizeCustomerTrips(params: {
  supabase: SupabaseClient;
  customerId: string;
  userId: string;
}) {
  const { error } = await params.supabase
    .from("trips")
    .update({
      customer_auth_user_id: null,
      rider_name: "Deleted Customer",
      rider_phone: null,
    })
    .eq("customer_id", params.customerId);

  if (!error) return;
  logNonCritical("customer trip anonymization failed", error);

  const { error: fallbackError } = await params.supabase
    .from("trips")
    .update({
      rider_name: "Deleted Customer",
      rider_phone: null,
    })
    .eq("customer_id", params.customerId);
  logNonCritical("fallback customer trip anonymization failed", fallbackError);
}

async function deleteDriverDocuments(supabase: SupabaseClient, driverId: string) {
  const { data, error } = await supabase
    .from("driver_documents")
    .select("file_path")
    .eq("driver_id", driverId);

  if (error) {
    logNonCritical("driver document lookup failed", error);
  }

  const paths = (data ?? [])
    .map((row) => (typeof row.file_path === "string" ? row.file_path : ""))
    .filter(Boolean);

  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from("driver-docs").remove(paths);
    logNonCritical("driver document storage cleanup failed", storageError);
  }

  await safeDeleteByDriverId(supabase, "driver_documents", driverId);
}

async function anonymizeDriverProfile(params: {
  supabase: SupabaseClient;
  driverId: string;
  reason: string | null;
  now: string;
}) {
  const driverPayload = {
    first_name: `Deleted Driver ${params.driverId.slice(0, 8)}`,
    last_name: null,
    phone: null,
    email: null,
    online: false,
    busy: false,
    status: "inactive",
    subscription_status: "inactive",
    profile_completed: false,
    vehicle_make: null,
    vehicle_model: null,
    vehicle_year: null,
    vehicle_color: null,
    vehicle_registration: null,
    vehicle_vin: null,
    vehicle_engine_number: null,
    seating_capacity: null,
    lat: null,
    lng: null,
    last_seen: null,
    deletion_requested_at: params.now,
    deletion_status: "completed",
    deleted_at: params.now,
    anonymized_at: params.now,
    deletion_reason: params.reason,
    updated_at: params.now,
  };

  const { error } = await params.supabase
    .from("drivers")
    .update(driverPayload)
    .eq("id", params.driverId);

  if (error) {
    logNonCritical("full driver anonymization failed", error);
    const { error: fallbackError } = await params.supabase
      .from("drivers")
      .update({
        first_name: `Deleted Driver ${params.driverId.slice(0, 8)}`,
        last_name: null,
        phone: null,
        email: null,
        online: false,
        busy: false,
        status: "inactive",
        vehicle_make: null,
        vehicle_model: null,
        vehicle_registration: null,
        updated_at: params.now,
      })
      .eq("id", params.driverId);
    logNonCritical("fallback driver anonymization failed", fallbackError);
  }

  const { error: profileError } = await params.supabase
    .from("driver_profiles")
    .update({
      first_name: null,
      last_name: null,
      phone: null,
      alt_phone: null,
      id_number: null,
      home_address: null,
      area_name: null,
      emergency_contact_name: null,
      emergency_contact_phone: null,
      license_number: null,
      license_code: null,
      license_expiry: null,
      pdp_number: null,
      pdp_expiry: null,
      deleted_at: params.now,
      updated_at: params.now,
    })
    .eq("driver_id", params.driverId);
  logNonCritical("driver profile anonymization failed", profileError);
}

async function deleteAuthUser(supabase: SupabaseClient, userId: string) {
  const { error } = await supabase.auth.admin.deleteUser(userId, true);
  if (error) {
    return {
      ok: false as const,
      status: 500,
      error: "We could not delete your login account. Please try again.",
    };
  }
  return { ok: true as const };
}

export async function deleteCustomerAccount(params: {
  supabase: SupabaseClient;
  user: { id: string; email?: string | null };
  customer: { id: string };
  password: string;
  confirmText: string;
  reason: string | null;
}): Promise<DeleteResult> {
  // Apple Guideline 5.1.1(v) Account Deletion Compliance
  if (params.confirmText !== "DELETE") {
    return { ok: false, status: 400, error: "Type DELETE to confirm account deletion." };
  }

  const verified = await verifyPassword({
    email: params.user.email,
    password: params.password,
  });
  if (!verified) {
    return { ok: false, status: 401, error: "Password verification failed. Please try again." };
  }

  const active = await hasActiveCustomerTrip(params.supabase, params.customer.id);
  if (!active.ok) {
    return { ok: false, status: 500, error: "We could not check your active rides. Please try again." };
  }
  if (active.active) {
    return { ok: false, status: 409, error: "Please complete or cancel your active ride before deleting your account." };
  }

  const now = new Date().toISOString();
  await cleanupCommonUserData(params.supabase, params.user.id);
  await safeDeleteByUserId(params.supabase, "customer_preferences", params.user.id);
  await safeDeleteByUserId(params.supabase, "saved_locations", params.user.id);
  await safeDeleteByUserId(params.supabase, "customer_saved_locations", params.user.id);
  await anonymizeCustomerTrips({
    supabase: params.supabase,
    customerId: params.customer.id,
    userId: params.user.id,
  });
  await anonymizeCustomerProfile({
    supabase: params.supabase,
    customerId: params.customer.id,
    userId: params.user.id,
    reason: params.reason,
    now,
  });

  return deleteAuthUser(params.supabase, params.user.id);
}

export async function deleteDriverAccount(params: {
  supabase: SupabaseClient;
  user: { id: string; email?: string | null };
  driverId: string;
  password: string;
  confirmText: string;
  reason: string | null;
}): Promise<DeleteResult> {
  // Apple Guideline 5.1.1(v) Account Deletion Compliance
  if (params.confirmText !== "DELETE") {
    return { ok: false, status: 400, error: "Type DELETE to confirm account deletion." };
  }

  const verified = await verifyPassword({
    email: params.user.email,
    password: params.password,
  });
  if (!verified) {
    return { ok: false, status: 401, error: "Password verification failed. Please try again." };
  }

  const active = await hasActiveDriverTrip(params.supabase, params.driverId);
  if (!active.ok) {
    return { ok: false, status: 500, error: "We could not check your active trips. Please try again." };
  }
  if (active.active) {
    return { ok: false, status: 409, error: "Please complete your active trip before deleting your account." };
  }

  const now = new Date().toISOString();
  await cleanupCommonUserData(params.supabase, params.user.id);
  await deleteDriverDocuments(params.supabase, params.driverId);
  await safeDeleteByDriverId(params.supabase, "driver_accounts", params.driverId);
  await anonymizeDriverProfile({
    supabase: params.supabase,
    driverId: params.driverId,
    reason: params.reason,
    now,
  });

  return deleteAuthUser(params.supabase, params.user.id);
}
