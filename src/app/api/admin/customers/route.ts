import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";

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
  let complete = true;
  for (let page = 1; page <= 50; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw result.error;
    users.push(...result.data.users);
    if (result.data.users.length < 1000) break;
    if (page === 50) complete = false;
  }
  return { users, complete };
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

    const url = new URL(req.url);
    const customerId = url.searchParams.get("customerId")?.trim() || null;
    const q = String(url.searchParams.get("q") ?? "").trim().toLowerCase();
    const statusFilter = String(url.searchParams.get("status") ?? "all").trim().toLowerCase();
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25));
    const tripPage = Math.max(1, Number.parseInt(url.searchParams.get("tripPage") ?? "1", 10) || 1);
    const tripPageSize = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("tripPageSize") ?? "25", 10) || 25));
    let profiles: CustomerRow[] = [];
    let profilesComplete = true;

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
      const result = await auth.supabaseAdmin.from("customers").select("*").order("id").limit(5001);
      if (result.error) throw result.error;
      profilesComplete = (result.data ?? []).length <= 5000;
      profiles = ((result.data ?? []).slice(0, 5000)) as CustomerRow[];
    }

    const requestedAuthIds = profiles
      .map((profile) => profile.auth_user_id)
      .filter((value): value is string => Boolean(value));
    if (customerId && profiles.length === 0) requestedAuthIds.push(customerId);

    const [authUserResult, driverAccounts, adminUsers] = await Promise.all([
      customerId
        ? Promise.all(requestedAuthIds.map(async (id) => {
            const result = await auth.supabaseAdmin.auth.admin.getUserById(id);
            if (result.error && result.error.status !== 404) throw result.error;
            return result.data.user ?? null;
          })).then((users) => users.filter((user): user is User => Boolean(user)))
          .then((users) => ({ users, complete: true }))
        : listAllAuthUsers(auth.supabaseAdmin),
      auth.supabaseAdmin.from("driver_accounts").select("user_id").limit(5000),
      auth.supabaseAdmin.from("admin_users").select("user_id").limit(5000),
    ]);
    if (driverAccounts.error || adminUsers.error) {
      console.error("[admin-customers] identity classification failed", {
        driverAccounts: driverAccounts.error,
        adminUsers: adminUsers.error,
      });
      return NextResponse.json(
        { ok: false, error: "Customer identity classification is unavailable. Please retry." },
        { status: 503 },
      );
    }
    const nonCustomerIds = new Set<string>([
      ...(driverAccounts.data ?? []).map((row) => String(row.user_id ?? "")).filter(Boolean),
      ...(adminUsers.data ?? []).map((row) => String(row.user_id ?? "")).filter(Boolean),
    ]);
    const authUsers = authUserResult.users.filter((user) => {
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

    let filteredIdentities = customerId
      ? identities.filter(({ profile, authUser }) =>
          profile?.id === customerId ||
          profile?.auth_user_id === customerId ||
          authUser?.id === customerId
        )
      : identities;
    if (!customerId && q) {
      filteredIdentities = filteredIdentities.filter(({ profile, authUser }) => [
        profile?.first_name, profile?.last_name, profile?.phone, profile?.normalized_phone,
        profile?.email, authUser?.email, authUser?.phone,
        textMeta(authUser, "first_name", "firstName"), textMeta(authUser, "last_name", "lastName"),
      ].filter(Boolean).join(" ").toLowerCase().includes(q));
    }
    if (!customerId && statusFilter !== "all") {
      filteredIdentities = filteredIdentities.filter(({ profile, authUser }) => {
        const bannedUntil = authUser?.banned_until ? new Date(authUser.banned_until).getTime() : 0;
        const state = profile?.status ?? (bannedUntil > Date.now() ? "inactive" : "active");
        return state.toLowerCase() === statusFilter;
      });
    }
    filteredIdentities.sort((a, b) => String(b.profile?.created_at ?? b.authUser?.created_at ?? "").localeCompare(String(a.profile?.created_at ?? a.authUser?.created_at ?? "")) || String(b.profile?.id ?? b.authUser?.id ?? "").localeCompare(String(a.profile?.id ?? a.authUser?.id ?? "")));
    const directoryTotal = filteredIdentities.length;
    if (!customerId) filteredIdentities = filteredIdentities.slice((page - 1) * pageSize, page * pageSize);

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
    let securityEvents: Array<{
      id: string;
      event_type: string;
      event_metadata: unknown;
      actor_role: string | null;
      created_at: string;
    }> = [];
    if (customerId && customerIds.length > 0) {
      const securityResult = await auth.supabaseAdmin
        .from("customer_security_events")
        .select("id,event_type,event_metadata,actor_role,created_at")
        .in("customer_id", customerIds)
        .order("created_at", { ascending: false })
        .limit(100);
      if (!securityResult.error) {
        securityEvents = securityResult.data ?? [];
      } else if (securityResult.error.code !== "42P01") {
        console.error("[admin-customers] security event lookup failed", securityResult.error);
      }
    }

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
        email_verified_at: authUser?.email_confirmed_at ?? null,
        phone_verified_at: authUser?.phone_confirmed_at ?? null,
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
        trips: customerId ? [...customerTrips]
          .sort((a, b) => activityTime(b).localeCompare(activityTime(a)) || b.id.localeCompare(a.id))
          .slice((tripPage - 1) * tripPageSize, tripPage * tripPageSize) : undefined,
        trip_page: customerId ? tripPage : undefined,
        trip_page_size: customerId ? tripPageSize : undefined,
        trip_total_pages: customerId ? Math.ceil(customerTrips.length / tripPageSize) : undefined,
      };
    });

    enriched.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));

    let membership: unknown = null;
    let membershipPayments: unknown[] = [];
    let membershipReadError: string | null = null;
    if (customerId && customerIds.length > 0 && isFinancialAdminRole(auth.profile.role)) {
      const [membershipResult, paymentsResult] = await Promise.all([
        auth.supabaseAdmin.from("phase5_memberships")
          .select("id,customer_id,payment_id,policy_version,starts_at,expires_at,status,activated_at,reversed_at")
          .in("customer_id", customerIds).order("expires_at", { ascending: false }).limit(1).maybeSingle(),
        auth.supabaseAdmin.from("phase5_membership_payments")
          .select("id,customer_id,amount_cents,currency,method,reference,status,submitted_at,reviewed_at,review_reason,financial_transaction_id")
          .in("customer_id", customerIds).order("submitted_at", { ascending: false }).limit(20),
      ]);
      if (membershipResult.error || paymentsResult.error) membershipReadError = "MOOVU+ membership information is unavailable.";
      else {
        membership = membershipResult.data ?? null;
        membershipPayments = paymentsResult.data ?? [];
      }
    } else if (customerId && !isFinancialAdminRole(auth.profile.role)) {
      membershipReadError = "MOOVU+ details require Financial Admin access. Use the authorised MOOVU+ review route.";
    }

    return NextResponse.json({
      ok: true,
      customers: enriched,
      customer: customerId ? enriched[0] ?? null : undefined,
      security_events: customerId ? securityEvents : undefined,
      page: customerId ? undefined : page,
      page_size: customerId ? undefined : pageSize,
      total: customerId ? undefined : authUserResult.complete && profilesComplete ? directoryTotal : null,
      total_lower_bound: customerId ? undefined : authUserResult.complete && profilesComplete ? null : directoryTotal,
      total_pages: customerId ? undefined : Math.ceil(directoryTotal / pageSize),
      available_pages: customerId ? undefined : Math.ceil(directoryTotal / pageSize),
      results_complete: customerId ? true : authUserResult.complete && profilesComplete,
      retrieval_warning: customerId || authUserResult.complete && profilesComplete ? null : !authUserResult.complete
        ? "Customer Auth retrieval reached 50,000 users. Directory results and counts are incomplete; a no-match result is not conclusive."
        : "Customer profile retrieval reached 5,000 records. Directory results and counts are incomplete; refine the search.",
      membership: customerId ? membership : undefined,
      membership_payments: customerId ? membershipPayments : undefined,
      membership_read_error: customerId ? membershipReadError : undefined,
    });
  } catch (error: unknown) {
    console.error("[admin-customers] lookup failed", error);
    return NextResponse.json(
      { ok: false, error: errorMessage(error, "Could not load customers.") },
      { status: 500 },
    );
  }
}
