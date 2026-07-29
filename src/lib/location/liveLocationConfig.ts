import { DISPATCH_CONFIG } from "@/lib/dispatch/config";

export const LIVE_LOCATION_CONFIG = {
  customerRefreshMs: 1000,
  customerDriverStaleSeconds: 30,
  customerDriverRadiusKm: DISPATCH_CONFIG.expandedRadiusKm,
  driverSampleMs: 1000,
  idleHeartbeatMs: 5000,
} as const;
