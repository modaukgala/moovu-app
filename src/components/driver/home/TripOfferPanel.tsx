import type { Offer, TripStop } from "./types";
import { money, rideTypeLabel } from "./utils";

export default function TripOfferPanel({ offer, stops, secondsLeft, responding, onRespond }: { offer: Offer | null; stops: TripStop[]; secondsLeft: number | null; responding: "accept" | "reject" | null; onRespond: (action: "accept" | "reject") => void }) {
  if (!offer) return null;
  return (
    <section className="moovu-driver-offer-drop" aria-live="assertive">
      <div className="moovu-driver-offer-drop-inner">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><span className="moovu-driver-offer-alert-dot" /><span className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">NEW TRIP NEARBY</span><span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-black text-blue-800">{secondsLeft != null ? `${secondsLeft}s left` : "Respond now"}</span></div>
          <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">{money(offer.final_fare ?? offer.fare_amount)}</div>
          <div className="mt-1 text-sm font-black uppercase tracking-[0.12em] text-slate-500">{rideTypeLabel(offer.ride_option)} - {offer.distance_km == null ? "Distance pending" : `${Number(offer.distance_km).toFixed(1)} km`} - {offer.duration_min == null ? "Time pending" : `${Math.round(Number(offer.duration_min))} min`}</div>
          <div className="mt-3 grid gap-2 text-sm font-semibold text-slate-700 sm:grid-cols-2"><div className="truncate"><span className="text-slate-400">Pickup:</span> {offer.pickup_address ?? "-"}</div><div className="truncate"><span className="text-slate-400">Dropoff:</span> {offer.dropoff_address ?? "-"}</div></div>
          {stops.length > 0 && <div className="mt-2 rounded-2xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">Stops: {stops.map((stop, index) => `Stop ${index + 1}: ${stop.address}`).join(" | ")}</div>}
        </div>
        <div className="grid min-w-full grid-cols-2 gap-2 sm:min-w-[230px]">
          <button type="button" className="moovu-driver-accept" disabled={responding !== null} onClick={() => onRespond("accept")}>{responding === "accept" ? "ACCEPTING..." : "ACCEPT"}</button>
          <button type="button" className="moovu-driver-decline" disabled={responding !== null} onClick={() => onRespond("reject")}>{responding === "reject" ? "DECLINING..." : "DECLINE"}</button>
        </div>
      </div>
    </section>
  );
}
