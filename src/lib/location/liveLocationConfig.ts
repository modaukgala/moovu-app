import { DISPATCH_CONFIG } from "@/lib/dispatch/config";

export const LIVE_LOCATION_CONFIG = {
  customerNearbyRefreshMs: 30000,
  customerNearbyHiddenRefreshMs: 30000,
  customerDriverStaleSeconds: 90,
  customerDriverRadiusKm: DISPATCH_CONFIG.expandedRadiusKm,
  customerTripStatusFallbackMs: 15000,
  customerTripStatusHiddenFallbackMs: 30000,
  customerTripLocationFallbackMs: 30000,
  customerTripLocationHiddenFallbackMs: 30000,
  // Keep local GPS responsive while limiting network/database publication.
  driverSampleMs: 2000,
  driverOfferPollMs: 10000,
  driverTripPollMs: 10000,
  driverHiddenPollMs: 15000,
  driverActiveHeartbeatMs: 30000,
  driverMovingHeartbeatMs: 30000,
  idleHeartbeatMs: 30000,
  adminFlagsRefreshMs: 60000,
  adminTripEventsRefreshMs: 30000,
  adminDispatchBoardRefreshMs: 15000,
  adminDispatchMapRefreshMs: 30000,
  chatOpenFallbackMs: 30000,
  chatClosedFallbackMs: 45000,
} as const;
