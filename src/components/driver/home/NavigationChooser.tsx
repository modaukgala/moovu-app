type NavigationChooserProps = {
  target: "pickup" | "dropoff" | null;
  pickupGoogle: string | null;
  pickupWaze: string | null;
  dropoffGoogle: string | null;
  dropoffWaze: string | null;
  onClose: () => void;
};

export default function NavigationChooser(props: NavigationChooserProps) {
  const { target, pickupGoogle, pickupWaze, dropoffGoogle, dropoffWaze, onClose } = props;
  if (!target) return null;
  const google = target === "pickup" ? pickupGoogle : dropoffGoogle;
  const waze = target === "pickup" ? pickupWaze : dropoffWaze;
  return (
    <div className="fixed inset-0 z-[9999] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <section className="moovu-driver-nav-sheet w-full max-w-sm">
        <div className="moovu-section-title">Open navigation</div>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">{target === "pickup" ? "Drive to pickup" : "Drive to destination"}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Choose your preferred map app for this trip leg.</p>
        <div className="mt-5 grid gap-3">
          {google && <a className="moovu-nav-choice" href={google} target="_blank" rel="noreferrer" onClick={onClose}><span className="moovu-nav-choice-icon">G</span><span><span className="block text-sm font-black text-slate-950">Google Maps</span><span className="block text-xs font-semibold text-slate-500">Open turn-by-turn directions</span></span></a>}
          {waze && <a className="moovu-nav-choice" href={waze} target="_blank" rel="noreferrer" onClick={onClose}><span className="moovu-nav-choice-icon">W</span><span><span className="block text-sm font-black text-slate-950">Waze</span><span className="block text-xs font-semibold text-slate-500">Use Waze traffic guidance</span></span></a>}
          <button type="button" className="moovu-btn moovu-btn-secondary w-full" onClick={onClose}>Cancel</button>
        </div>
      </section>
    </div>
  );
}
