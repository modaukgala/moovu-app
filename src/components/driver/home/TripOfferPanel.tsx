import type { Offer, TripStop } from "./types";
import { money, rideTypeLabel } from "./utils";

export default function TripOfferPanel({ offer, stops, secondsLeft, responding, onRespond }: { offer: Offer | null; stops: TripStop[]; secondsLeft: number | null; responding: "accept" | "reject" | null; onRespond: (action: "accept" | "reject") => void }) {
  if (!offer) return null;
  return (
    <section className="moovu-driver-offer-drop" aria-label="Incoming trip offer" aria-live="assertive">
      <div className="moovu-driver-offer-drop-inner">
        <div className="min-w-0">
          <div className="driver-offer-heading"><span className="moovu-driver-offer-alert-dot" aria-hidden="true" /><strong>New trip nearby</strong><span className="driver-offer-countdown" aria-live="off" aria-label={secondsLeft != null ? `${secondsLeft} seconds remaining` : "Respond now"}>{secondsLeft != null ? `${secondsLeft}s left` : "Respond now"}</span></div>
          <div className="driver-offer-fare"><span>Trip fare</span><strong>{money(offer.final_fare ?? offer.fare_amount)}</strong></div>
          <div className="driver-offer-meta">{rideTypeLabel(offer.ride_option)} · {offer.distance_km == null ? "Distance pending" : `${Number(offer.distance_km).toFixed(1)} km`} · {offer.duration_min == null ? "Time pending" : `${Math.round(Number(offer.duration_min))} min`}</div>
          <div className="driver-offer-route"><div><span>Pickup</span><strong>{offer.pickup_address ?? "Not provided"}</strong></div><div><span>Destination</span><strong>{offer.dropoff_address ?? "Not provided"}</strong></div></div>
          {stops.length > 0 && <div className="mt-2 rounded-2xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">Stops: {stops.map((stop, index) => `Stop ${index + 1}: ${stop.address}`).join(" | ")}</div>}
        </div>
        <div className="grid min-w-full grid-cols-2 gap-2 sm:min-w-[230px]">
          <button type="button" className="moovu-driver-accept" disabled={responding !== null} onClick={() => onRespond("accept")}>{responding === "accept" ? "Accepting…" : "Accept trip"}</button>
          <button type="button" className="moovu-driver-decline" disabled={responding !== null} onClick={() => onRespond("reject")}>{responding === "reject" ? "Declining…" : "Decline"}</button>
        </div>
      </div>
    </section>
  );
}
