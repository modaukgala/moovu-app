import type { RefObject } from "react";
import { CircleHelp, Layers3, LocateFixed, Menu } from "lucide-react";
import { money } from "./utils";

type DriverMapSurfaceProps = {
  mapRef: RefObject<HTMLDivElement | null>;
  mapError: string | null;
  menuOpen: boolean;
  todayEarnings: number;
  todayTrips?: number;
  amountOwed?: number;
  online: boolean;
  busy: boolean;
  satelliteMap: boolean;
  onToggleMenu: () => void;
  onOpenEarnings: () => void;
  onRetryGps: () => void;
  onToggleMapType: () => void;
  onToggleOnline: () => void;
};

export default function DriverMapSurface({
  mapRef,
  mapError,
  menuOpen,
  todayEarnings,
  todayTrips = 0,
  amountOwed = 0,
  online,
  busy,
  satelliteMap,
  onToggleMenu,
  onOpenEarnings,
  onRetryGps,
  onToggleMapType,
  onToggleOnline,
}: DriverMapSurfaceProps) {
  return (
    <div className="moovu-driver-map-card">
      <div className="driver-map-top-controls">
        <button
          type="button"
          className="driver-map-round-button"
          onClick={onToggleMenu}
          aria-label={menuOpen ? "Close driver menu" : "Open driver menu"}
          aria-expanded={menuOpen}
        >
          <Menu aria-hidden="true" />
        </button>
        <button type="button" className="driver-map-earnings-pill" onClick={onOpenEarnings}>
          <strong>{money(todayEarnings)}</strong>
          <span>Today</span>
        </button>
        <a
          className="driver-map-round-button dp-help-button"
          href="/api/support/whatsapp?topic=driver"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Get help on WhatsApp"
        >
          <CircleHelp aria-hidden="true" />
          <span>Help</span>
        </a>
      </div>

      <div className="driver-map-side-controls">
        <button type="button" onClick={onRetryGps} aria-label="Centre current location">
          <LocateFixed aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onToggleMapType}
          aria-label={satelliteMap ? "Show road map" : "Show satellite map"}
        >
          <Layers3 aria-hidden="true" />
        </button>
      </div>

      {mapError ? (
        <div className="flex h-[58vh] items-center justify-center bg-slate-50 p-6 text-sm text-slate-700" role="status">
          {mapError}
        </div>
      ) : (
        <div ref={mapRef} className="driver-map-canvas w-full bg-slate-100" aria-label="Driver map" />
      )}

      <div className="moovu-driver-map-sheet">
        <div className="driver-availability-copy" role="status" aria-live="polite">
          <span className={online ? "driver-availability-dot is-online" : "driver-availability-dot"} aria-hidden="true" />
          <span>
            <strong>{online ? "You're online" : "You're offline"}</strong>
            <small>{online ? "Finding trips near you" : "Tap Go online when you are ready to drive"}</small>
          </span>
        </div>
        <div className="dp-stats">
          <div><span>Trips today</span><strong>{todayTrips}</strong></div>
          <div><span>Earned today</span><strong>{money(todayEarnings)}</strong></div>
          <div className={amountOwed > 0 ? "is-owed" : ""}><span>You owe</span><strong>{money(amountOwed)}</strong></div>
        </div>
          <button
            type="button"
            className={online ? "driver-map-primary-status is-online" : "driver-map-primary-status"}
            disabled={busy}
            aria-pressed={online}
            onClick={onToggleOnline}
          >
            {busy ? "Updating status…" : online ? "Go offline" : "Go online"}
          </button>
      </div>
    </div>
  );
}
