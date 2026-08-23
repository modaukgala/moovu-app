export type Offer = {
  id: string;
  status: string;
  offer_status: string;
  offer_expires_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  distance_km?: number | null;
  duration_min?: number | null;
  fare_amount: number | null;
  payment_method: string | null;
  ride_option?: string | null;
  stops?: unknown;
  original_fare?: number | null;
  final_add_stop_increase?: number | null;
  final_fare?: number | null;
  stop_waiting_fee?: number | null;
  estimated_fare?: number | null;
  fare_adjustment_amount?: number | null;
  current_fare?: number | null;
  actual_distance_km?: number | null;
  actual_duration_min?: number | null;
};

export type CurrentTrip = {
  id: string;
  status: string;
  driver_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  fare_amount: number | null;
  payment_method: string | null;
  rider_name?: string | null;
  rider_phone?: string | null;
  created_at: string | null;
  driver_arrived_at?: string | null;
  no_show_eligible_at?: string | null;
  ride_option?: string | null;
  stops?: unknown;
  original_fare?: number | null;
  final_add_stop_increase?: number | null;
  final_fare?: number | null;
  stop_waiting_fee?: number | null;
  estimated_fare?: number | null;
  fare_adjustment_amount?: number | null;
  current_fare?: number | null;
  actual_distance_km?: number | null;
  actual_duration_min?: number | null;
  fare_breakdown?: { pickupInstruction?: unknown } | null;
};

export type TripStop = { address: string; lat: number; lng: number };

export type Driver = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: string | null;
  online: boolean | null;
  busy: boolean | null;
  profile_completed?: boolean | null;
  verification_status?: string | null;
  subscription_status?: string | null;
  subscription_expires_at?: string | null;
  subscription_plan?: string | null;
  lat: number | null;
  lng: number | null;
  last_seen: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_registration?: string | null;
};

export type GpsNotice = {
  message: string;
  tone: "success" | "warning" | "danger" | "info";
};

export type DriverEarningsTrip = {
  driver_net_earnings?: number | string | null;
  fare_amount?: number | string | null;
  commission_amount?: number | string | null;
  completed_at?: string | null;
  created_at?: string | null;
};

export type DriverEarningsSnapshot = {
  todayEarnings: number;
  todayTrips: number;
  weekEarnings: number;
  amountOwed: number;
  completedTrips: number;
};

export type TripActionResponse = {
  ok?: boolean;
  error?: string;
  fare?: { finalFare?: number };
  commission?: { driverNet?: number; commissionAmount?: number };
};

export type CompletedFareSummary = {
  tripId: string;
  finalFare: number;
  driverNet: number;
  commissionAmount: number;
};

declare global {
  interface Window {
    google: typeof google;
  }
}
