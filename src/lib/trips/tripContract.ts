export const TRIP_STATUSES = [
  "requested", "offered", "assigned", "arrived", "ongoing", "completed", "cancelled",
] as const;

export type TripStatus = (typeof TRIP_STATUSES)[number];

export const DISPATCHABLE_TRIP_STATUSES: readonly TripStatus[] = ["requested", "offered"];
export const ACTIVE_ASSIGNED_TRIP_STATUSES: readonly TripStatus[] = ["assigned", "arrived", "ongoing"];
export const TERMINAL_TRIP_STATUSES: readonly TripStatus[] = ["completed", "cancelled"];

const TRANSITIONS: Record<TripStatus, readonly TripStatus[]> = {
  requested: ["offered", "cancelled"],
  offered: ["requested", "assigned", "cancelled"],
  assigned: ["arrived", "cancelled"],
  arrived: ["ongoing", "cancelled"],
  ongoing: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function isTripStatus(value: unknown): value is TripStatus {
  return typeof value === "string" && (TRIP_STATUSES as readonly string[]).includes(value);
}

export function canTransitionTrip(from: TripStatus, to: TripStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type TripCommunicationEvent = string;
export type TripFinancialEvent = string;
export type TripAuditEvent = string;
