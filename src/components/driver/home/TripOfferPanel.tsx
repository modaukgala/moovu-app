import { CreditCard, Banknote, X } from "lucide-react";
import SlideToAccept from "@/components/driver/premium/SlideToAccept";
import type { Offer, TripStop } from "./types";
import { money, rideTypeLabel } from "./utils";

const OFFER_WINDOW_SECONDS = 40;
// Display only: drivers keep 85% after the 15% MOOVU commission.
const DRIVER_SHARE = 0.85;

export default function TripOfferPanel({ offer, stops, secondsLeft, responding, onRespond }: { offer: Offer | null; stops: TripStop[]; secondsLeft: number | null; responding: "accept" | "reject" | null; onRespond: (action: "accept" | "reject") => void }) {
  if (!offer) return null;
  const fare = offer.final_fare ?? offer.fare_amount;
  const keep = fare == null ? null : Math.round(Number(fare) * DRIVER_SHARE * 100) / 100;
  const card = String(offer.payment_method ?? "").toLowerCase() !== "cash";
  const ring = secondsLeft == null ? 1 : Math.max(0, Math.min(1, secondsLeft / OFFER_WINDOW_SECONDS));
  const circumference = 2 * Math.PI * 24;

  return (
    <div className="dp-offer-backdrop">
      <section className="moovu-driver-offer-drop dp-offer" aria-label="Incoming trip offer" aria-live="assertive">
        <div className="dp-offer-head">
          <span className="dp-offer-ring" aria-label={secondsLeft != null ? `${secondsLeft} seconds remaining` : "Respond now"}>
            <svg viewBox="0 0 56 56" aria-hidden="true">
              <circle cx="28" cy="28" r="24" className="dp-ring-bg" />
              <circle cx="28" cy="28" r="24" className="dp-ring-fg" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ring)} />
            </svg>
            <strong>{secondsLeft ?? "!"}</strong>
          </span>
          <h2>New trip offer</h2>
          <button type="button" className="dp-offer-close" disabled={responding !== null} onClick={() => onRespond("reject")} aria-label="Decline offer">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="dp-offer-tags">
          <span className="dp-tag is-blue">{rideTypeLabel(offer.ride_option)}</span>
          <span className="dp-tag">{card ? <CreditCard aria-hidden="true" /> : <Banknote aria-hidden="true" />}{card ? "Card" : "Cash"}</span>
        </div>

        <div className="dp-offer-fare">{money(fare)}</div>
        {keep != null ? <div className="dp-offer-keep">You earn about {money(keep)}</div> : null}

        <div className="dp-offer-tiles">
          <div><span>Trip</span><strong>{offer.distance_km == null ? "—" : `${Number(offer.distance_km).toFixed(1)} km`}{offer.duration_min == null ? "" : ` · ${Math.round(Number(offer.duration_min))} min`}</strong></div>
          <div><span>Stops</span><strong>{stops.length === 0 ? "None" : stops.length}</strong></div>
        </div>

        <div className="dp-offer-route">
          <div><i className="is-pickup" aria-hidden="true" /><span>Pickup</span><strong>{offer.pickup_address ?? "Not provided"}</strong></div>
          {stops.map((stop, index) => (
            <div key={index}><i className="is-stop" aria-hidden="true" /><span>Stop {index + 1}</span><strong>{stop.address}</strong></div>
          ))}
          <div><i className="is-drop" aria-hidden="true" /><span>Drop-off</span><strong>{offer.dropoff_address ?? "Not provided"}</strong></div>
        </div>

        <SlideToAccept
          label="Slide to accept"
          busyLabel="Accepting…"
          busy={responding === "accept"}
          disabled={responding !== null}
          onAccept={() => onRespond("accept")}
        />
        <button type="button" className="moovu-driver-decline dp-offer-decline" disabled={responding !== null} onClick={() => onRespond("reject")}>
          {responding === "reject" ? "Declining…" : "Decline"}
        </button>
      </section>
    </div>
  );
}
