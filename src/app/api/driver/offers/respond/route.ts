import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUserFromBearer } from "@/app/api/driver/utils";
import {
  advanceDriverOfferIfNeeded,
  expirePendingOfferIfNeeded,
  isMissingOfferTableError,
  offerNextEligibleDriver,
} from "@/lib/trip-offers";
import { notifyAdmins, notifyCustomerForTrip } from "@/lib/push-notify";
import { respondToOffer } from "@/lib/dispatch/respondToOffer";

async function incrementOfferStat(driverId: string, field: "offers_accepted" | "offers_rejected") {
  const { data: stats } = await supabaseAdmin
    .from("driver_offer_stats")
    .select("*")
    .eq("driver_id", driverId)
    .maybeSingle();

  const current = stats ?? {
    offers_received: 0,
    offers_accepted: 0,
    offers_rejected: 0,
    offers_missed: 0,
  };

  await supabaseAdmin.from("driver_offer_stats").upsert(
    {
      driver_id: driverId,
      offers_received: Number(current.offers_received || 0),
      offers_accepted:
        field === "offers_accepted"
          ? Number(current.offers_accepted || 0) + 1
          : Number(current.offers_accepted || 0),
      offers_rejected:
        field === "offers_rejected"
          ? Number(current.offers_rejected || 0) + 1
          : Number(current.offers_rejected || 0),
      offers_missed: Number(current.offers_missed || 0),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "driver_id" }
  );
}

export async function POST(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }

    const { tripId, action } = await req.json();

    if (!tripId || !action) {
      return NextResponse.json({ ok: false, error: "Missing tripId/action" }, { status: 400 });
    }

    if (action !== "accept" && action !== "reject") {
      return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
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
        { ok: false, code: "NOT_LINKED", error: "Not linked" },
        { status: 403 }
      );
    }

    const atomicResponse = await respondToOffer({
      tripId: String(tripId),
      driverId,
      action: action === "accept" ? "accept" : "decline",
      source: "driver_app",
    });

    if (!atomicResponse.atomicUnavailable) {
      return NextResponse.json(
        atomicResponse.ok
          ? { ok: true, status: atomicResponse.state }
          : { ok: false, error: atomicResponse.error },
        { status: atomicResponse.status },
      );
    }

    const { data: trip, error: tripError } = await supabaseAdmin
      .from("trips")
      .select("id,driver_id,status,offer_status,offer_expires_at,offer_attempted_driver_ids")
      .eq("id", tripId)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json(
        { ok: false, error: tripError?.message ?? "Trip not found" },
        { status: 404 }
      );
    }

    if (trip.offer_status !== "pending" || trip.status !== "offered") {
      return NextResponse.json(
        { ok: false, error: "No pending offer for your account" },
        { status: 400 }
      );
    }

    const { data: activeOffer, error: activeOfferError } = await supabaseAdmin
      .from("driver_trip_offers")
      .select("id,accept_deadline_at")
      .eq("trip_id", tripId)
      .eq("driver_id", driverId)
      .in("status", ["pending", "shown"])
      .maybeSingle();

    const offerTableMissing = isMissingOfferTableError(activeOfferError);

    if (activeOfferError) {
      if (!offerTableMissing) {
        return NextResponse.json(
          { ok: false, error: activeOfferError.message },
          { status: 500 }
        );
      }
    }

    if (!offerTableMissing && !activeOffer) {
      return NextResponse.json(
        { ok: false, error: "No pending offer for your account" },
        { status: 400 }
      );
    }

    if (offerTableMissing && trip.driver_id !== driverId) {
      return NextResponse.json(
        { ok: false, error: "No pending offer for your account" },
        { status: 400 }
      );
    }

    const deadlineSource = offerTableMissing ? trip.offer_expires_at : activeOffer?.accept_deadline_at;
    const deadlineMs = deadlineSource ? new Date(deadlineSource).getTime() : null;

    if (!deadlineMs || Date.now() > deadlineMs) {
      const expiryResult = offerTableMissing
        ? await expirePendingOfferIfNeeded(tripId)
        : await advanceDriverOfferIfNeeded(tripId, driverId);

      if (offerTableMissing && expiryResult.expired) {
        const next = await offerNextEligibleDriver(tripId, [driverId]);
        if (!next.ok) {
          const repeat = await offerNextEligibleDriver(tripId, [], {
            excludePreviouslyAttempted: false,
            resendToDriverId: driverId,
          });

          return NextResponse.json({
            ok: false,
            error: repeat.ok
              ? "Offer expired before your response. A fresh offer was sent to you."
              : "Offer expired before your response.",
            expired: true,
            reoffered: repeat.ok,
            nextDriverId: repeat.ok ? repeat.driverId : null,
          });
        }

        return NextResponse.json({
          ok: false,
          error: "Offer expired before your response. It has been passed to another eligible driver.",
          expired: true,
          reoffered: true,
          nextDriverId: next.driverId,
        });
      }

      return NextResponse.json({
        ok: false,
        error: "reoffered" in expiryResult && expiryResult.reoffered
          ? "Offer expired before your response. The system has sent a fresh offer."
          : "Offer expired before your response.",
        expired: true,
        reoffered: "reoffered" in expiryResult ? !!expiryResult.reoffered : false,
        nextDriverId: "nextDriverId" in expiryResult ? expiryResult.nextDriverId ?? null : null,
      });
    }

    if (action === "accept") {
      const { data: acceptedTrip, error: acceptError } = await supabaseAdmin
        .from("trips")
        .update({
          status: "assigned",
          offer_status: "accepted",
          offer_expires_at: null,
          driver_id: driverId,
        })
        .eq("id", tripId)
        .eq("status", "offered")
        .eq("offer_status", "pending")
        .select("id")
        .maybeSingle();

      if (acceptError) {
        return NextResponse.json({ ok: false, error: acceptError.message }, { status: 500 });
      }

      if (!acceptedTrip) {
        return NextResponse.json(
          { ok: false, error: "This trip was already accepted or is no longer available." },
          { status: 409 }
        );
      }

      await supabaseAdmin.from("drivers").update({ busy: true }).eq("id", driverId);

      try {
        await incrementOfferStat(driverId, "offers_accepted");
      } catch {}

      const now = new Date().toISOString();
      const { data: competingOffers } = offerTableMissing
        ? { data: [] }
        : await supabaseAdmin
            .from("driver_trip_offers")
            .select("driver_id")
            .eq("trip_id", tripId)
            .neq("driver_id", driverId)
            .in("status", ["pending", "shown"]);

      const competingDriverIds = Array.from(
        new Set((competingOffers ?? []).map((offer) => offer.driver_id).filter(Boolean))
      );

      const { error: acceptedOfferError } = offerTableMissing
        ? { error: null }
        : await supabaseAdmin
            .from("driver_trip_offers")
            .update({ status: "accepted", responded_at: now, updated_at: now })
            .eq("trip_id", tripId)
            .eq("driver_id", driverId)
            .in("status", ["pending", "shown"]);

      if (acceptedOfferError) {
        console.error("[driver-offers] failed to mark offer accepted", {
          tripId,
          driverId,
          reason: acceptedOfferError.message,
        });
      }

      const { data: acceptingDriver } = await supabaseAdmin
        .from("drivers")
        .select("first_name,last_name,phone")
        .eq("id", driverId)
        .maybeSingle();
      const acceptingDriverName =
        `${acceptingDriver?.first_name ?? ""} ${acceptingDriver?.last_name ?? ""}`.trim() ||
        acceptingDriver?.phone ||
        "A driver";

      const { error: cancelOtherOffersError } = offerTableMissing
        ? { error: null }
        : await supabaseAdmin
            .from("driver_trip_offers")
            .update({ status: "cancelled", responded_at: now, updated_at: now })
            .eq("trip_id", tripId)
            .neq("driver_id", driverId)
            .in("status", ["pending", "shown"]);

      if (cancelOtherOffersError) {
        console.error("[driver-offers] failed to cancel competing offers", {
          tripId,
          driverId,
          reason: cancelOtherOffersError.message,
        });
      }

      if (competingDriverIds.length > 0) {
        await supabaseAdmin.from("drivers").update({ busy: false }).in("id", competingDriverIds);
      }

      try {
        await supabaseAdmin.from("trip_events").insert({
          trip_id: tripId,
          event_type: "offer_accepted",
          message: `${acceptingDriverName} accepted the trip`,
          old_status: "offered",
          new_status: "assigned",
        });
      } catch {}

      await notifyCustomerForTrip(
        tripId,
        "Driver Accepted Your Ride",
        "A driver has accepted your trip and is on the way.",
        `/ride/${tripId}`
      );

      await notifyAdmins(
        "Driver accepted trip",
        `${acceptingDriverName} accepted trip ${tripId}.`,
        "/admin/trips"
      );

      return NextResponse.json({ ok: true, status: "assigned" });
    }

    const { error: freeDriverError } = await supabaseAdmin
      .from("drivers")
      .update({ busy: false })
      .eq("id", driverId);

    if (freeDriverError) {
      return NextResponse.json({ ok: false, error: freeDriverError.message }, { status: 500 });
    }

    try {
      await incrementOfferStat(driverId, "offers_rejected");
    } catch {}

    const { error: declinedOfferError } = offerTableMissing
      ? { error: null }
      : await supabaseAdmin
          .from("driver_trip_offers")
          .update({
            status: "declined",
            responded_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("trip_id", tripId)
          .eq("driver_id", driverId)
          .in("status", ["pending", "shown"]);

    if (declinedOfferError) {
      console.error("[driver-offers] failed to mark offer declined", {
        tripId,
        driverId,
        reason: declinedOfferError.message,
      });
    }

    let next:
      | Awaited<ReturnType<typeof offerNextEligibleDriver>>
      | { ok: false; driverId?: null } = { ok: false };

    if (trip.driver_id === driverId) {
      const attemptedDriverIds = Array.from(
        new Set([...(trip.offer_attempted_driver_ids ?? []), driverId])
      );

      const { error: rejectError } = await supabaseAdmin
        .from("trips")
        .update({
          driver_id: null,
          status: "requested",
          offer_status: "rejected",
          offer_expires_at: null,
          offer_attempted_driver_ids: attemptedDriverIds,
        })
        .eq("id", tripId)
        .eq("driver_id", driverId);

      if (rejectError) {
        return NextResponse.json({ ok: false, error: rejectError.message }, { status: 500 });
      }

      next = await offerNextEligibleDriver(tripId, [driverId]);
    }

    try {
      await supabaseAdmin.from("trip_events").insert({
        trip_id: tripId,
        event_type: "offer_rejected",
        message: "Driver rejected",
        old_status: "offered",
        new_status: "requested",
      });
    } catch {}

    await notifyAdmins(
      "Driver rejected trip",
      `A driver rejected trip ${tripId}. The system is finding the next eligible driver.`,
      "/admin/trips"
    );

    return NextResponse.json({
      ok: true,
      status: next.ok ? "offered" : "requested",
      reoffered: !!next.ok,
      nextDriverId: next.ok ? next.driverId : null,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Server error" },
      { status: 500 }
    );
  }
}
