import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type TripChatRole = "customer" | "driver";

export type TripChatMessage = {
  id: string;
  trip_id: string;
  sender_user_id: string;
  sender_role: TripChatRole;
  body: string;
  created_at: string;
  read_at: string | null;
};

export type TripChatAccess = {
  userId: string;
  role: TripChatRole;
  trip: {
    id: string;
    status: string;
    customer_id: string | null;
    customer_auth_user_id: string | null;
    driver_id: string | null;
  };
  canSend: boolean;
  canRead: boolean;
  supabaseAdmin: SupabaseClient;
};

const READABLE_CHAT_STATUSES = new Set([
  "assigned",
  "arrived",
  "ongoing",
  "completed",
  "cancelled",
]);

const SENDABLE_CHAT_STATUSES = new Set(["assigned", "arrived", "ongoing"]);

function createUserSupabase(accessToken: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: { persistSession: false },
    },
  );
}

function createAdminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

function readBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
}

export function normalizeTripMessageBody(value: unknown) {
  const body = typeof value === "string" ? value.trim() : "";

  if (!body) {
    return { ok: false as const, error: "Message cannot be blank." };
  }

  if (body.length > 1000) {
    return { ok: false as const, error: "Message must be 1000 characters or less." };
  }

  return { ok: true as const, body };
}

export function chatPreview(body: string) {
  const normalized = body.replace(/\s+/g, " ").trim();
  return normalized.length > 90 ? `${normalized.slice(0, 87)}...` : normalized;
}

export async function getTripChatAccess(
  req: Request,
  tripId: string,
): Promise<
  | { ok: true; access: TripChatAccess }
  | { ok: false; status: number; error: string }
> {
  const accessToken = readBearerToken(req);

  if (!accessToken) {
    return { ok: false, status: 401, error: "Missing access token." };
  }

  const supabaseUser = createUserSupabase(accessToken);
  const {
    data: { user },
    error: userError,
  } = await supabaseUser.auth.getUser();

  if (userError || !user) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }

  const supabaseAdmin = createAdminSupabase();

  const { data: trip, error: tripError } = await supabaseAdmin
    .from("trips")
    .select("id,status,customer_id,customer_auth_user_id,driver_id")
    .eq("id", tripId)
    .maybeSingle();

  if (tripError) {
    return { ok: false, status: 500, error: tripError.message };
  }

  if (!trip) {
    return { ok: false, status: 404, error: "Trip not found." };
  }

  const normalizedTrip = {
    id: String(trip.id),
    status: String(trip.status ?? ""),
    customer_id: trip.customer_id ? String(trip.customer_id) : null,
    customer_auth_user_id: trip.customer_auth_user_id
      ? String(trip.customer_auth_user_id)
      : null,
    driver_id: trip.driver_id ? String(trip.driver_id) : null,
  };

  let role: TripChatRole | null = null;

  if (normalizedTrip.customer_auth_user_id === user.id) {
    role = "customer";
  }

  if (!role && normalizedTrip.customer_id) {
    const { data: customer } = await supabaseAdmin
      .from("customers")
      .select("id")
      .eq("id", normalizedTrip.customer_id)
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (customer?.id) role = "customer";
  }

  if (!role && normalizedTrip.driver_id) {
    const { data: driverAccount } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .eq("driver_id", normalizedTrip.driver_id)
      .maybeSingle();

    if (driverAccount?.driver_id) role = "driver";
  }

  if (!role) {
    return { ok: false, status: 403, error: "You do not have access to this trip chat." };
  }

  const hasAcceptedDriver = Boolean(normalizedTrip.driver_id);
  const canRead = hasAcceptedDriver && READABLE_CHAT_STATUSES.has(normalizedTrip.status);
  const canSend = hasAcceptedDriver && SENDABLE_CHAT_STATUSES.has(normalizedTrip.status);

  if (!canRead) {
    return { ok: false, status: 403, error: "Chat is available after a driver accepts the trip." };
  }

  return {
    ok: true,
    access: {
      userId: user.id,
      role,
      trip: normalizedTrip,
      canRead,
      canSend,
      supabaseAdmin,
    },
  };
}
