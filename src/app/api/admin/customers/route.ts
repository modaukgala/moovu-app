import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { requireAdminUser } from "@/lib/auth/admin";

type CustomerRow = {
  id: string;
  auth_user_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  normalized_phone?: string | null;
  email?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type CustomerTripRow = {
  id: string;
  customer_id: string | null;
  customer_auth_user_id?: string | null;
  status: string | null;
  fare_amount: number | null;
  final_fare?: number | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  payment_method: string | null;
  created_at: string | null;
  completed_at?: string | null;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function tripValue(trip: CustomerTripRow) {
  return Number(trip.final_fare ?? trip.fare_amount ?? 0);
}

function activityTime(trip: CustomerTripRow) {
  return trip.completed_at || trip.created_at || "";
}

function textMeta(user: User | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = user?.user_metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function listAllAuthUsers(
  admin: SupabaseClient,
) {
  const users: User[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw result.error;
    users.push(...result.data.users);
    if (result.data.users.length < 1000) break;
  }
  return users;
}

async function fetchTripsByIds(params: {
  admin: SupabaseClient;
  column: "customer_id" | "customer_auth_user_id";
  ids: string[];
}) {
  const rows: CustomerTripRow[] = [];
  for (let offset = 0; offset < params.ids.length; offset += 100) {
    const ids = params.ids.slice(offset, offset + 100);
    if (ids.length === 0) continue;
    const full = await params.admin
      .from("trips")
      .select(
        "id,customer_id,customer_auth_user_id,status,fare_amount,final_fare,pickup_address,dropoff_address,payment_method,created_at,completed_at",
      )
      .in(params.column, ids)
      .order("created_at", { ascending: false })
      .limit(5000);

    if (!full.error) {
      rows.push(...((full.data ?? []) as CustomerTripRow[]));
      continue;
    }

    const legacy = await params.admin
      .from("trips")
      .select(
        "id,customer_id,status,fare_amount,pickup_address,dropoff_address,payment_method,created_at",
      )
      .in("customer_id", ids)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (legacy.error) throw legacy.error;
    rows.push(...((legacy.data ?? []) as CustomerTripRow[]));
  }
  return rows;
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const customerId = new URL(req.url).searchParams.get("customerId")?.trim() || null;
    let profiles: CustomerRow[] = [];

    if (customerId) {
      const byId = await auth.supabaseAdmin
        .from("customers")
        .select("*")
        .eq("id", customerId)
        .maybeSingle();
      if (byId.error) throw byId.error;

      if (byId.data) {
        profiles = [byId.data as CustomerRow];
      } else {
        const byAuthId = await auth.supabaseAdmin
          .from("customers")
          .select("*")
          .eq("auth_user_id", customerId)
          .maybeSingle();
        if (byAuthId.error) throw byAuthId.error;
        if (byAuthId.data) profiles = [byAuthId.data as CustomerRow];
      }
    } else {
      const result = await auth.supabaseAdmin.from("customers").select("*").limit(5000);
      if (result.error) throw result.error;
      profiles = (result.data ?? []) as CustomerRow[];
    }

    const [allAuthUsers, driverAccounts, adminUsers] = await Promise.all([
      listAllAuthUsers(auth.supabaseAdmin),
      auth.supabaseAdmin.from("driver_accounts").select("user_id").limit(5000),
      auth.supabaseAdmin.from("admin_users").select("user_id").limit(5000),
    ]);
    const nonCustomerIds = new Set<string>([
      ...(driverAccounts.data ?? []).map((row) => String(row.user_id ?? "")).filter(Boolean),
      ...(adminUsers.data ?? []).map((row) => String(row.user_id ?? "")).filter(Boolean),
    ]);
    const authUsers = allAuthUsers.filter((user) => {
      const role = String(user.user_metadata?.role ?? user.app_metadata?.role ?? "").toLowerCase();
      return !nonCustomerIds.has(user.id) && !["admin", "driver"].includes(role);
    });
    const authById = new Map(authUsers.map((user) => [user.id, user]));
    const profileByAuthId = new Map(
      profiles
        .filter((profile) => profile.auth_user_id)
        .map((profile) => [String(profile.auth_user_id), profile]),
    );

    const identities: Array<{ profile: CustomerRow | null; authUser: User | null }> = [];
    for (const profile of profiles) {
      identities.push({
        profile,
        authUser: profile.auth_user_id ? authById.get(profile.auth_user_id) ?? null : null,
      });
    }
    for (const authUser of authUsers) {
      if (!profileByAuthId.has(authUser.id)) identities.push({ profile: null, authUser });
    }

    const filteredIdentities = customerId
      ? identities.filter(({ profile, authUser }) =>
          profile?.id === customerId ||
          profile?.auth_user_id === customerId ||
          authUser?.id === customerId
        )
      : identities;

    const customerIds = filteredIdentities
      .map(({ profile }) => profile?.id)
      .filter((value): value is string => Boolean(value));
    const authIds = filteredIdentities
      .map(({ profile, authUser }) => profile?.auth_user_id ?? authUser?.id)
      .filter((value): value is string => Boolean(value));

    const [profileTrips, authTrips] = await Promise.all([
      fetchTripsByIds({ admin: auth.supabaseAdmin, column: "customer_id", ids: customerIds }),
      fetchTripsByIds({ admin: auth.supabaseAdmin, column: "customer_auth_user_id", ids: authIds }),
    ]);
    const tripById = new Map<string, CustomerTripRow>();
    for (const trip of [...profileTrips, ...authTrips]) tripById.set(trip.id, trip);
    const trips = [...tripById.values()];

    const enriched = filteredIdentities.map(({ profile, authUser }) => {
      const authUserId = profile?.auth_user_id ?? authUser?.id ?? null;
      const customerTrips = trips.filter((trip) =>
        (profile?.id && trip.customer_id === profile.id) ||
        (authUserId && trip.customer_auth_user_id === authUserId)
      );
      const completedTrips = customerTrips.filter((trip) => trip.status === "completed");
      const cancelledTrips = customerTrips.filter((trip) =>
        ["cancelled", "canceled", "no_show"].includes(String(trip.status ?? "").toLowerCase()),
      );
      const lastTrip = [...customerTrips].sort((a, b) =>
        activityTime(b).localeCompare(activityTime(a)),
      )[0] ?? null;
      const bannedUntil = authUser?.banned_until ? new Date(authUser.banned_until).getTime() : 0;
      const status = profile?.status ?? (bannedUntil > Date.now() ? "inactive" : "active");

      return {
        id: profile?.id ?? authUser?.id,
        auth_user_id: authUserId,
        account_source: profile ? "customer_profile" : "auth_only",
        first_name: profile?.first_name ?? textMeta(authUser, "first_name", "firstName"),
        last_name: profile?.last_name ?? textMeta(authUser, "last_name", "lastName"),
        phone:
          profile?.phone ??
          profile?.normalized_phone ??
          authUser?.phone ??
          textMeta(authUser, "phone", "cellphone"),
        email: profile?.email ?? authUser?.email ?? null,
        status,
        created_at: profile?.created_at ?? authUser?.created_at ?? null,
        updated_at: profile?.updated_at ?? authUser?.updated_at ?? null,
        total_trips: customerTrips.length,
        completed_trips: completedTrips.length,
        cancelled_trips: cancelledTrips.length,
        total_spend: completedTrips.reduce((total, trip) => total + tripValue(trip), 0),
        last_trip_status: lastTrip?.status ?? null,
        last_activity:
          (lastTrip ? activityTime(lastTrip) : null) ||
          profile?.updated_at ||
          authUser?.last_sign_in_at ||
          profile?.created_at ||
          authUser?.created_at ||
          null,
        trips: customerId ? customerTrips : undefined,
      };
    });

    enriched.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));

    return NextResponse.json({
      ok: true,
      customers: enriched,
      customer: customerId ? enriched[0] ?? null : undefined,
    });
  } catch (error: unknown) {
    console.error("[admin-customers] lookup failed", error);
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "Could not load customers.") },
      { status: 500 },
    );
  }
}
