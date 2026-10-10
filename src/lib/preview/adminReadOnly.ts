const DISPOSABLE_PROJECT_HOST = "tangtlmdpnvmoviwrgvd.supabase.co";

const EXTERNAL_DELIVERY_KEYS = [
  "YOCO_SECRET_KEY",
  "YOCO_WEBHOOK_SECRET",
  "PUSH_INTERNAL_API_KEY",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_PRIVATE_KEY",
  "VAPID_PRIVATE_KEY",
  "OUTBOX_JOB_SECRET",
  "CRON_SECRET",
  "DISPATCH_JOB_SECRET",
] as const;

const READ_ONLY_ADMIN_APIS = new Set([
  "/api/admin/analytics",
  "/api/admin/application-summary",
  "/api/admin/applications",
  "/api/admin/archive",
  "/api/admin/customers",
  "/api/admin/dispatch/board",
  "/api/admin/dispatch/map",
  "/api/admin/driver-applications",
  "/api/admin/driver-profile",
  "/api/admin/driver-wallet-summary",
  "/api/admin/drivers/list",
  "/api/admin/drivers/options",
  "/api/admin/earnings",
  "/api/admin/maps/usage",
  "/api/admin/notifications/logs",
  "/api/admin/onboarding",
  "/api/admin/online-payments",
  "/api/admin/payment-reviews",
  "/api/admin/phase2-finance/recovery",
  "/api/admin/phase4-finance",
  "/api/admin/phase5-credits",
  "/api/admin/phase5-memberships",
  "/api/admin/pricing/surge",
  "/api/admin/receipts",
  "/api/admin/reports",
  "/api/admin/reports/driver-earnings",
  "/api/admin/settlements",
  "/api/admin/subscriptions/drivers",
  "/api/admin/subscriptions/history",
  "/api/admin/trips/events",
  "/api/admin/trips/list",
]);

export type PreviewDecision = "allow" | "configuration_blocked" | "route_blocked";

export function adminPreviewDecision(input: {
  env: Record<string, string | undefined>;
  pathname: string;
  method: string;
}): PreviewDecision {
  const { env, pathname, method } = input;
  if (env.VERCEL_ENV !== "preview") return "allow";

  let databaseHost: string;
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    databaseHost = url.protocol === "https:" && !url.username && !url.password ? url.hostname : "";
  } catch {
    databaseHost = "";
  }
  if (env.MOOVU_ADMIN_PREVIEW_READ_ONLY !== "true" || databaseHost !== DISPOSABLE_PROJECT_HOST ||
    env.PHASE05_OUTBOX_ENABLED === "true" ||
    EXTERNAL_DELIVERY_KEYS.some(key => Boolean(env[key]?.trim()))) return "configuration_blocked";

  if (method !== "GET" && method !== "HEAD") return "route_blocked";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "allow";
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico" ||
    pathname === "/icon.png" || pathname.startsWith("/images/") || pathname.startsWith("/logo")) return "allow";
  if (READ_ONLY_ADMIN_APIS.has(pathname) ||
    /^\/api\/admin\/(?:trips|receipts)\/[0-9a-f-]{36}$/i.test(pathname)) return "allow";
  return "route_blocked";
}
