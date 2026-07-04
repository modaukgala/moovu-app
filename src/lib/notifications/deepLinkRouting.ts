export type NotificationRouteRole = "customer" | "driver" | "admin";

export type NotificationRoutingPayload = Record<string, unknown>;

const ALLOWED_HOSTS = new Set([
  "moovurides.co.za",
  "www.moovurides.co.za",
  "driver.moovurides.co.za",
  "admin.moovurides.co.za",
  "localhost",
  "127.0.0.1",
]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRole(value: unknown): NotificationRouteRole | null {
  const role = text(value).toLowerCase();
  return role === "customer" || role === "driver" || role === "admin" ? role : null;
}

function normalizeType(value: unknown) {
  return text(value).toLowerCase().replace(/[\s-]+/g, "_");
}

export function safeInternalNotificationUrl(value: unknown) {
  const raw = text(value);
  if (!raw) return "";

  try {
    const url = new URL(raw, "https://moovurides.co.za");
    if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return "";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
}

export function notificationTripId(payload: NotificationRoutingPayload) {
  const direct =
    text(payload.tripId) ||
    text(payload.trip_id) ||
    text(payload.rideId) ||
    text(payload.ride_id);
  if (direct) return direct;

  const route = safeInternalNotificationUrl(payload.url || payload.nativeClickUrl);
  if (!route) return "";

  try {
    const url = new URL(route, "https://moovurides.co.za");
    const routeMatch = url.pathname.match(/^\/ride\/([^/]+)/);
    return (
      text(url.searchParams.get("tripId")) ||
      text(url.searchParams.get("offerTripId")) ||
      text(routeMatch?.[1])
    );
  } catch {
    return "";
  }
}

export function inferNotificationType(params: {
  title?: unknown;
  url?: unknown;
  data?: NotificationRoutingPayload;
}) {
  const data = params.data ?? {};
  const explicit =
    normalizeType(data.notificationType) ||
    normalizeType(data.type) ||
    normalizeType(data.nativeActionType);
  if (explicit) return explicit;

  const title = text(params.title).toLowerCase();
  const route = safeInternalNotificationUrl(params.url || data.url);

  if (route.includes("chat=1") || title.includes("message")) return "chat_message";
  if (route.includes("/receipt") || title.includes("receipt")) return "receipt_ready";
  if (title.includes("re-offer")) return "trip_reoffer";
  if (title.includes("new trip") || title.includes("trip offer")) return "trip_offer";
  if (title.includes("accepted") || title.includes("assigned")) return "driver_assigned";
  if (title.includes("arrived")) return "driver_arrived";
  if (title.includes("started")) return "trip_started";
  if (title.includes("completed")) return "trip_completed";
  if (title.includes("cancel")) return "trip_cancelled";
  if (title.includes("subscription")) return "subscription_update";
  if (title.includes("document")) return "document_request";
  if (title.includes("approved") || title.includes("rejected")) return "admin_approval";
  if (title.includes("support")) return "support_reply";
  if (title.includes("payment")) return "payment_update";
  return "general_update";
}

function inferScreen(role: NotificationRouteRole, type: string) {
  if (role === "driver") {
    if (type === "trip_offer" || type === "trip_reoffer") return "trip_offer";
    if (type === "chat_reply" || type === "chat_message" || type === "customer_message") return "trip_chat";
    if (type === "subscription_update" || type === "subscription_reminder") return "subscriptions";
    if (type === "document_request") return "driver_application";
    if (type === "trip_completed") return "trip_history";
    if (type === "trip_started" || type === "trip_updated") return "active_trip";
    return "driver_home";
  }

  if (role === "customer") {
    if (type === "chat_reply" || type === "chat_message" || type === "driver_message") return "trip_chat";
    if (type === "trip_completed" || type === "receipt_ready" || type === "payment_update") return "receipt";
    if (type === "support_reply") return "trip_support";
    if (type.startsWith("trip_") || type.startsWith("driver_")) return "trip_status";
    return "customer_home";
  }

  return "admin_home";
}

export function buildNotificationRoutingData(params: {
  role?: NotificationRouteRole | null;
  title: string;
  url?: string;
  data?: Record<string, string | number | boolean | null | undefined>;
}) {
  const role = params.role ?? normalizeRole(params.data?.role) ?? "customer";
  const route = safeInternalNotificationUrl(params.url || params.data?.url) || "/";
  const type = inferNotificationType({ title: params.title, url: route, data: params.data });
  const tripId = notificationTripId({ ...(params.data ?? {}), url: route });

  return {
    ...(params.data ?? {}),
    notificationType: type,
    type,
    screen: text(params.data?.screen) || inferScreen(role, type),
    role,
    url: route,
    ...(tripId ? { tripId, trip_id: tripId } : {}),
  };
}

export function resolveNotificationTarget(
  payload: NotificationRoutingPayload,
  fallbackRole: NotificationRouteRole = "customer",
) {
  const explicitUrl = safeInternalNotificationUrl(payload.url || payload.nativeClickUrl);
  const role =
    normalizeRole(payload.role) ??
    (explicitUrl.startsWith("/driver") ? "driver" : explicitUrl.startsWith("/admin") ? "admin" : fallbackRole);
  const type = inferNotificationType({
    title: payload.title,
    url: explicitUrl,
    data: payload,
  });
  const tripId = notificationTripId({ ...payload, url: explicitUrl });

  if (role === "driver") {
    if ((type === "trip_offer" || type === "trip_reoffer") && tripId) {
      return `/driver?offerTripId=${encodeURIComponent(tripId)}`;
    }
    if (["chat_reply", "chat_message", "customer_message"].includes(type) && tripId) {
      return `/driver?chat=1&tripId=${encodeURIComponent(tripId)}`;
    }
    if (["trip_started", "trip_updated"].includes(type) && tripId) {
      return `/driver?tripId=${encodeURIComponent(tripId)}`;
    }
    if (type === "trip_completed") return "/driver/history";
    if (type === "trip_cancelled") return "/driver";
    if (["subscription_update", "subscription_reminder"].includes(type)) return "/driver/subscriptions";
    if (type === "document_request") return "/driver/complete-profile";
    if (type === "admin_approval") return "/driver";
    if (explicitUrl.startsWith("/driver")) return explicitUrl;
    return "/driver";
  }

  if (role === "customer") {
    if (["chat_reply", "chat_message", "driver_message"].includes(type) && tripId) {
      return `/ride/${encodeURIComponent(tripId)}?chat=1`;
    }
    if (["trip_completed", "receipt_ready", "payment_update"].includes(type) && tripId) {
      return `/ride/${encodeURIComponent(tripId)}/receipt`;
    }
    if (type === "support_reply" && tripId) {
      return `/ride/${encodeURIComponent(tripId)}/support`;
    }
    if (
      ["driver_assigned", "driver_arrived", "trip_started", "trip_cancelled", "trip_updated"].includes(type) &&
      tripId
    ) {
      return `/ride/${encodeURIComponent(tripId)}`;
    }
    if (explicitUrl.startsWith("/ride") || explicitUrl.startsWith("/book")) return explicitUrl;
    return tripId ? `/ride/${encodeURIComponent(tripId)}` : "/ride/history";
  }

  return explicitUrl.startsWith("/admin") ? explicitUrl : "/admin";
}
