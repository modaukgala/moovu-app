import { DISPATCH_CONFIG } from "@/lib/dispatch/config";

export const LIVE_LOCATION_CONFIG = {
  customerNearbyRefreshMs: 8000,
  customerNearbyHiddenRefreshMs: 15000,
  customerDriverStaleSeconds: 30,
  customerDriverRadiusKm: DISPATCH_CONFIG.expandedRadiusKm,
  customerTripStatusFallbackMs: 15000,
  customerTripStatusHiddenFallbackMs: 30000,
  customerTripLocationFallbackMs: 10000,
  customerTripLocationHiddenFallbackMs: 20000,
  driverSampleMs: 2000,
  driverOfferPollMs: 10000,
  driverTripPollMs: 10000,
  driverActiveHeartbeatMs: 3000,
  driverMovingHeartbeatMs: 5000,
  idleHeartbeatMs: 15000,
  adminFlagsRefreshMs: 60000,
  adminTripEventsRefreshMs: 30000,
  adminDispatchBoardRefreshMs: 15000,
  adminDispatchMapRefreshMs: 15000,
  chatOpenFallbackMs: 30000,
  chatClosedFallbackMs: 45000,
} as const;
