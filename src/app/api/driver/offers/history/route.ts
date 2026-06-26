import { NextResponse } from "next/server";
import { getUserFromBearer } from "@/app/api/driver/utils";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isMissingOfferTableError } from "@/lib/trip-offers";

const OFFER_SELECT = `
  id,
  trip_id,
  driver_id,
  status,
  offered_at,
  visible_until,
  escalates_at,
  accept_deadline_at,
  responded_at,
  distance_km,
  dispatch_score,
  created_at,
  updated_at
`;

const TRIP_SELECT = `
  id,
  pickup_address,
  dropoff_address,
  fare_amount,
  distance_km,
  duration_min,
  payment_method,
  status,
  offer_status,
  ride_option,
  created_at
`;

type OfferRow = {
  id: string;
  trip_id: string | null;
  driver_id: string;
  status: string | null;
  offered_at: string | null;
  visible_until: string | null;
  escalates_at: string | null;
  accept_deadline_at: string | null;
  responded_at: string | null;
  distance_km: number | string | null;
  dispatch_score: number | string | null;
  created_at: string | null;
  updated_at: string | null;
};

type TripRow = {
  id: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  fare_amount: number | string | null;
  distance_km: number | string | null;
  duration_min: number | string | null;
  payment_method: string | null;
  status: string | null;
  offer_status: string | null;
  ride_option?: string | null;
  created_at: string | null;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error.";
}

export async function GET(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not logged in." }, { status: 401 });
    }

    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mappingError) {
      return NextResponse.json({ ok: false, error: mappingError.message }, { status: 500 });
    }

    const driverId = mapping?.driver_id ?? null;
    if (!driverId) {
      return NextResponse.json(
        { ok: false, code: "NOT_LINKED", error: "Your account is not linked to a driver yet." },
        { status: 403 },
      );
    }

    const url = new URL(req.url);
    const limitParam = Number(url.searchParams.get("limit") ?? 80);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 150) : 80;

    const { data: offerRows, error: offerError } = await supabaseAdmin
      .from("driver_trip_offers")
      .select(OFFER_SELECT)
      .eq("driver_id", driverId)
      .order("offered_at", { ascending: false })
      .limit(limit);

    if (offerError) {
      if (isMissingOfferTableError(offerError)) {
        return NextResponse.json({
          ok: true,
          offers: [],
          summary: {
            received: 0,
            accepted: 0,
            declined: 0,
            missed: 0,
            cancelled: 0,
          },
          setupRequired: "driver_trip_offers table is not available yet.",
        });
      }

      return NextResponse.json({ ok: false, error: offerError.message }, { status: 500 });
    }

    const offers = (offerRows ?? []) as OfferRow[];
    const tripIds = Array.from(new Set(offers.map((offer) => offer.trip_id).filter(Boolean))) as string[];

    let tripsById = new Map<string, TripRow>();
    if (tripIds.length > 0) {
      const { data: trips, error: tripsError } = await supabaseAdmin
        .from("trips")
        .select(TRIP_SELECT)
        .in("id", tripIds);

      if (tripsError) {
        return NextResponse.json({ ok: false, error: tripsError.message }, { status: 500 });
      }

      tripsById = new Map(((trips ?? []) as TripRow[]).map((trip) => [trip.id, trip]));
    }

    const normalizedOffers = offers.map((offer) => {
      const trip = offer.trip_id ? tripsById.get(offer.trip_id) ?? null : null;
      return {
        id: offer.id,
        trip_id: offer.trip_id,
        status: offer.status,
        offered_at: offer.offered_at,
        visible_until: offer.visible_until,
        escalates_at: offer.escalates_at,
        accept_deadline_at: offer.accept_deadline_at,
        responded_at: offer.responded_at,
        distance_to_pickup_km: offer.distance_km,
        dispatch_score: offer.dispatch_score,
        trip: trip
          ? {
              id: trip.id,
              pickup_address: trip.pickup_address,
              dropoff_address: trip.dropoff_address,
              fare_amount: trip.fare_amount,
              distance_km: trip.distance_km,
              duration_min: trip.duration_min,
              payment_method: trip.payment_method,
              status: trip.status,
              offer_status: trip.offer_status,
              ride_option: trip.ride_option ?? null,
              created_at: trip.created_at,
            }
          : null,
      };
    });

    const summary = normalizedOffers.reduce(
      (totals, offer) => {
        totals.received += 1;
        if (offer.status === "accepted") totals.accepted += 1;
        else if (offer.status === "declined") totals.declined += 1;
        else if (offer.status === "expired") totals.missed += 1;
        else if (offer.status === "cancelled") totals.cancelled += 1;
        return totals;
      },
      { received: 0, accepted: 0, declined: 0, missed: 0, cancelled: 0 },
    );

    return NextResponse.json({
      ok: true,
      offers: normalizedOffers,
      summary,
    });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}
