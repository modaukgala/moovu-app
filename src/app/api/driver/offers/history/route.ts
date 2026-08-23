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
  driver_id,
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
  driver_id: string | null;
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

type OfferOutcome =
  | "accepted_by_you"
  | "accepted_by_another"
  | "missed"
  | "declined"
  | "cancelled"
  | "pending";

function offerOutcome(offer: OfferRow, trip: TripRow | null, driverId: string): OfferOutcome {
  const status = String(offer.status ?? "").toLowerCase();
  const tripStatus = String(trip?.status ?? "").toLowerCase();

  if (status === "accepted") return "accepted_by_you";
  if (["declined", "rejected"].includes(status)) return "declined";
  if (status === "expired") return "missed";
  if (["pending", "shown"].includes(status)) return "pending";

  if (
    status === "cancelled" &&
    trip?.driver_id &&
    trip.driver_id !== driverId &&
    (tripStatus !== "cancelled" || trip.offer_status === "accepted")
  ) {
    return "accepted_by_another";
  }

  return "cancelled";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error.";
}

async function countOffers(driverId: string, status?: string) {
  let query = supabaseAdmin
    .from("driver_trip_offers")
    .select("id", { count: "exact", head: true })
    .eq("driver_id", driverId);

  if (status) query = query.eq("status", status);

  const { count, error } = await query;
  return { count: count ?? 0, error };
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
    const pageParam = Number(url.searchParams.get("page") ?? 1);
    const limitParam = Number(url.searchParams.get("limit") ?? 20);
    const page = Number.isFinite(pageParam) ? Math.max(Math.floor(pageParam), 1) : 1;
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.floor(limitParam), 1), 50) : 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const [receivedCount, acceptedCount, declinedCount, missedCount, cancelledCount] =
      await Promise.all([
        countOffers(driverId),
        countOffers(driverId, "accepted"),
        countOffers(driverId, "declined"),
        countOffers(driverId, "expired"),
        countOffers(driverId, "cancelled"),
      ]);

    const countError = [
      receivedCount,
      acceptedCount,
      declinedCount,
      missedCount,
      cancelledCount,
    ].find((result) => result.error)?.error;

    if (countError && !isMissingOfferTableError(countError)) {
      return NextResponse.json({ ok: false, error: countError.message }, { status: 500 });
    }

    const { data: offerRows, error: offerError } = await supabaseAdmin
      .from("driver_trip_offers")
      .select(OFFER_SELECT)
      .eq("driver_id", driverId)
      .order("offered_at", { ascending: false })
      .range(from, to);

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
        outcome: offerOutcome(offer, trip, driverId),
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

    const summary = {
      received: receivedCount.count,
      accepted: acceptedCount.count,
      declined: declinedCount.count,
      missed: missedCount.count,
      cancelled: cancelledCount.count,
    };

    return NextResponse.json({
      ok: true,
      offers: normalizedOffers,
      summary,
      pagination: {
        page,
        limit,
        total: summary.received,
        hasMore: to + 1 < summary.received,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}
