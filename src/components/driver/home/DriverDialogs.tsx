import type { CompletedFareSummary, CurrentTrip } from "./types";
import { END_OTP_BYPASS_REASONS, money } from "./utils";

export function SubscriptionRequiredDialog({ open, onClose, onChoosePlan }: { open: boolean; onClose: () => void; onChoosePlan: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <section className="w-full max-w-sm rounded-[28px] border border-blue-100 bg-white p-6 shadow-[0_30px_90px_rgba(15,23,42,0.28)]" role="dialog" aria-modal="true" aria-labelledby="subscription-reminder-title">
        <div className="inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-amber-700">Subscription required</div>
        <h2 id="subscription-reminder-title" className="mt-4 text-2xl font-black text-slate-950">Your MOOVU subscription has expired.</h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">You need an active subscription to continue receiving trip requests. Any active trip remains uninterrupted.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" className="moovu-btn moovu-btn-secondary" onClick={onClose}>Not now</button>
          <button type="button" className="moovu-btn moovu-btn-primary" onClick={onChoosePlan}>Choose a plan</button>
        </div>
      </section>
    </div>
  );
}

type EndOtpBypassDialogProps = {
  open: boolean;
  trip: CurrentTrip | null;
  reason: string;
  note: string;
  busy: boolean;
  onReasonChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function EndOtpBypassDialog(props: EndOtpBypassDialogProps) {
  const { open, trip, reason, note, busy, onReasonChange, onNoteChange, onCancel, onConfirm } = props;
  if (!open || trip?.status !== "ongoing") return null;
  return (
    <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-[28px] border border-amber-100 bg-white p-6 shadow-[0_30px_90px_rgba(15,23,42,0.3)]" role="dialog" aria-modal="true" aria-labelledby="end-trip-without-otp-title">
        <div className="inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-amber-700">Confirmation required</div>
        <h2 id="end-trip-without-otp-title" className="mt-4 text-2xl font-black text-slate-950">End trip without OTP?</h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">You are confirming that the trip has ended and that you have received the fare from the customer.</p>
        <div className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm">
          <div className="flex items-start justify-between gap-4"><span className="font-semibold text-slate-500">Final fare</span><strong className="text-xl text-slate-950">{money(trip.final_fare ?? trip.fare_amount)}</strong></div>
          <div className="flex items-start justify-between gap-4"><span className="font-semibold text-slate-500">Customer</span><strong className="text-right text-slate-950">{trip.rider_name ?? "Customer"}</strong></div>
          <div className="flex items-start justify-between gap-4"><span className="font-semibold text-slate-500">Destination</span><strong className="max-w-[65%] text-right text-slate-950">{trip.dropoff_address ?? "Destination"}</strong></div>
        </div>
        <label className="mt-5 block text-sm font-black text-slate-800" htmlFor="end-otp-bypass-reason">Why is the End OTP unavailable?</label>
        <select id="end-otp-bypass-reason" className="moovu-input mt-2" value={reason} onChange={(event) => onReasonChange(event.target.value)} disabled={busy}>
          {END_OTP_BYPASS_REASONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        {reason === "Other" && <textarea className="moovu-input mt-3 min-h-24 resize-y" value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="Briefly explain what happened" maxLength={240} disabled={busy} />}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" className="moovu-btn moovu-btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="moovu-btn bg-amber-600 text-white disabled:opacity-60" disabled={busy || (reason === "Other" && note.trim().length < 3)} onClick={onConfirm}>{busy ? "Completing..." : "Confirm & End Trip"}</button>
        </div>
      </section>
    </div>
  );
}

export function TripCompletionOverlay({ summary, confirming, onReceived, onHide }: { summary: CompletedFareSummary | null; confirming: boolean; onReceived: () => void; onHide: () => void }) {
  if (!summary) return null;
  return (
    <div className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <section className="w-full max-w-sm rounded-[28px] border border-emerald-100 bg-white p-6 shadow-[0_30px_90px_rgba(15,23,42,0.3)]" role="dialog" aria-modal="true" aria-labelledby="driver-final-fare-title">
        <div className="inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-emerald-700">Trip completed</div>
        <h2 id="driver-final-fare-title" className="mt-4 text-2xl font-black text-slate-950">Collect final fare</h2>
        <div className="mt-5 rounded-3xl bg-slate-950 px-5 py-6 text-center text-white"><div className="text-xs font-black uppercase tracking-[0.16em] text-slate-300">Customer pays</div><div className="mt-2 text-5xl font-black">{money(summary.finalFare)}</div></div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-emerald-50 p-3"><span className="block text-xs font-bold text-emerald-700">Your earnings</span><strong className="mt-1 block text-lg text-emerald-950">{money(summary.driverNet)}</strong></div>
          <div className="rounded-2xl bg-blue-50 p-3"><span className="block text-xs font-bold text-blue-700">MOOVU commission</span><strong className="mt-1 block text-lg text-blue-950">{money(summary.commissionAmount)}</strong></div>
        </div>
        <p className="mt-4 text-sm font-semibold leading-6 text-slate-600">The trip is complete and you can receive new offers. Confirm only after the customer has paid.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" className="moovu-btn moovu-btn-primary" disabled={confirming} onClick={onReceived}>{confirming ? "Saving..." : "Received"}</button>
          <button type="button" className="moovu-btn moovu-btn-secondary" disabled={confirming} onClick={onHide}>Hide</button>
        </div>
      </section>
    </div>
  );
}
