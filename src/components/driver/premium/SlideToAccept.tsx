"use client";

import { useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

type Props = { label: string; busyLabel: string; busy: boolean; disabled: boolean; onAccept: () => void };

/**
 * Drag the knob to the end to accept. Keyboard users press Enter/Space on it,
 * and a plain tap also works after a short hold, so nobody is locked out.
 */
export default function SlideToAccept({ label, busyLabel, busy, disabled, onAccept }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const [dx, setDx] = useState(0);

  const maxDx = () => {
    const track = trackRef.current;
    return track ? track.clientWidth - 60 : 240;
  };
  const fire = () => {
    if (disabled || busy) return;
    setDx(maxDx());
    onAccept();
  };
  const end = () => {
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    if (startXRef.current == null) return;
    startXRef.current = null;
    if (dx >= maxDx() * 0.8) fire();
    else setDx(0);
  };

  return (
    <div ref={trackRef} className={`dp-slide${busy ? " is-busy" : ""}`} aria-disabled={disabled}>
      <span className="dp-slide-label">{busy ? busyLabel : label}</span>
      <button
        type="button"
        className="dp-slide-knob"
        style={{ transform: `translateX(${dx}px)` }}
        disabled={disabled || busy}
        aria-label={label}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            fire();
          }
        }}
        onPointerDown={(event) => {
          if (disabled || busy) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          startXRef.current = event.clientX - dx;
          holdTimerRef.current = window.setTimeout(fire, 900);
        }}
        onPointerMove={(event) => {
          if (startXRef.current == null) return;
          const next = Math.max(0, Math.min(maxDx(), event.clientX - startXRef.current));
          if (next > 8 && holdTimerRef.current) {
            window.clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
          }
          setDx(next);
        }}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  );
}
