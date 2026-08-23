import type { CurrentTrip, Driver, GpsNotice, Offer, TripStop } from "./types";

export const DEFAULT_CENTER = { lat: -25.12, lng: 29.05 };
export const DRIVER_CANCEL_REASONS = [
  "Customer asked to cancel",
  "Could not reach pickup",
  "Unsafe pickup situation",
  "Vehicle issue",
  "Emergency",
  "Other",
] as const;
export const END_OTP_BYPASS_REASONS = [
  "Customer phone unavailable/dead",
  "Customer unable to access OTP",
  "Connectivity issue",
  "Customer left vehicle",
  "Other",
] as const;

export function googleMapsLink(lat: number | null | undefined, lng: number | null | undefined) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}&travelmode=driving`;
}

export function wazeLink(lat: number | null | undefined, lng: number | null | undefined) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return `https://waze.com/ul?ll=${encodeURIComponent(`${lat},${lng}`)}&navigate=yes`;
}

export function tripStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "assigned": return "Head to pickup";
    case "arrived": return "Waiting for OTP";
    case "ongoing": return "Drive to destination";
    case "completed": return "Completed";
    default: return status || "No trip";
  }
}

export function rideTypeLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "group" || normalized === "xl" || normalized.includes("xl")) return "MOOVU Go XL";
  if (normalized === "scheduled") return "Scheduled ride";
  return "MOOVU Go";
}

export function driverStageDetail(params: { driver: Driver | null; offer: Offer | null; currentTrip: CurrentTrip | null }) {
  const { driver, offer, currentTrip } = params;
  if (offer) return { eyebrow: "New request", title: "New trip nearby", body: "Review pickup, destination, fare and timer before accepting.", action: "Accept or decline" };
  if (currentTrip?.status === "assigned") return { eyebrow: "Stage 1", title: "Navigate to pickup", body: "Drive to the pickup point, then mark arrived when you reach the customer.", action: "Drive to pickup" };
  if (currentTrip?.status === "arrived") return { eyebrow: "Stage 2", title: "Verify pickup OTP", body: "Ask the customer for the start OTP before the ride begins.", action: "Start trip with OTP" };
  if (currentTrip?.status === "ongoing") return { eyebrow: "Stage 4", title: "Trip in progress", body: "Drive to destination and complete the ride with the end OTP.", action: "Complete trip" };
  return {
    eyebrow: driver?.online ? "Online" : "Offline",
    title: driver?.online ? "Ready for nearby requests" : "Go online to drive",
    body: driver?.online ? "Keep GPS active and stay ready for local MOOVU trip offers." : "Go online when you are available, subscribed, and ready to accept rides.",
    action: driver?.online ? "Waiting for request" : "Go online",
  };
}

export function gpsNoticeClass(tone: GpsNotice["tone"]) {
  switch (tone) {
    case "success": return "border-emerald-100 bg-emerald-50 text-emerald-700";
    case "warning": return "border-amber-200 bg-amber-50 text-amber-800";
    case "danger": return "border-red-100 bg-red-50 text-red-700";
    default: return "border-blue-100 bg-blue-50 text-blue-700";
  }
}

export function friendlyGeolocationError(err: GeolocationPositionError): GpsNotice {
  switch (err.code) {
    case err.PERMISSION_DENIED: return { tone: "warning", message: "Location permission is blocked. Allow location access for MOOVU in your browser or app settings, then tap Save current GPS. You can use manual location meanwhile." };
    case err.POSITION_UNAVAILABLE: return { tone: "danger", message: "MOOVU could not read your GPS position. Check that location services are on, then try again." };
    case err.TIMEOUT: return { tone: "warning", message: "GPS took too long to respond. Move to an open area or check your signal, then try again." };
    default: return { tone: "danger", message: "MOOVU could not refresh GPS. Check location access and try again." };
  }
}

export function gpsNoticeMessage(notice: GpsNotice | string) { return typeof notice === "string" ? notice : notice.message; }
export function gpsNoticeTone(notice: GpsNotice | string): GpsNotice["tone"] { return typeof notice !== "string" ? notice.tone : notice.toLowerCase().includes("gps live") ? "success" : "info"; }

export function parseTripStops(value: unknown): TripStop[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2).map((stop) => {
    const item = (stop ?? {}) as { address?: unknown; lat?: unknown; lng?: unknown };
    return { address: typeof item.address === "string" ? item.address : "", lat: Number(item.lat), lng: Number(item.lng) };
  }).filter((stop) => stop.address.trim() && Number.isFinite(stop.lat) && Number.isFinite(stop.lng));
}

export function money(value: number | null | undefined) { return `R${Number(value ?? 0).toFixed(2)}`; }
export function num(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) ? n : 0; }

export function subscriptionTone(driver: Driver | null) {
  if (!driver) return { label: "Inactive", message: "Your subscription must be active to receive trips.", className: "border-red-100 bg-red-50 text-red-700" };
  const status = String(driver.subscription_status ?? "").toLowerCase();
  const expiryMs = driver.subscription_expires_at ? new Date(driver.subscription_expires_at).getTime() : NaN;
  const daysLeft = Number.isFinite(expiryMs) ? Math.ceil((expiryMs - Date.now()) / 86400000) : null;
  if (status === "active" || status === "grace") {
    if (daysLeft != null && daysLeft <= 3) return { label: "Expiring soon", message: "Your subscription is expiring soon. Renew to keep receiving trips.", className: "border-amber-200 bg-amber-50 text-amber-800" };
    return { label: "Active", message: "Only active subscribed drivers receive trips.", className: "border-emerald-100 bg-emerald-50 text-emerald-700" };
  }
  return { label: "Inactive", message: "Your subscription must be active to receive trips.", className: "border-red-100 bg-red-50 text-red-700" };
}

export function canReceiveTripOffers(driver: Driver | null) {
  if (!driver) return false;
  const status = String(driver.subscription_status ?? "").toLowerCase();
  return status === "active" || status === "grace";
}
