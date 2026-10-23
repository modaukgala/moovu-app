"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import MoovuLoadingScene from "./MoovuLoadingScene";
import styles from "./MoovuLoadingScreen.module.css";

type Props = { message?: string; layout?: "full" | "contained"; theme?: "light" | "dark" };

export function MoovuInlineLoader({ message = "Loading..." }: { message?: string }) {
  return <span className={styles.inline} role="status" aria-live="polite">
    <span className={styles.spinner} aria-hidden="true" />{message}
  </span>;
}

export default function MoovuLoadingScreen({ message = "Connecting your kasi...", layout = "full", theme = "light" }: Props) {
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const update = () => root.current?.setAttribute("data-paused", String(document.hidden));
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  // Callers own readiness: no minimum duration, timers, or interception of initialization.
  return <section ref={root} className={styles.screen} data-layout={layout} data-theme={theme} aria-label="MOOVU loading">
    <div className={styles.content}>
      <div className={styles.logoCrop}>
        <Image src={theme === "dark" ? "/Moovu-White.png" : "/Moovu-Black.png"} alt="MOOVU Kasi Rides"
          width={1024} height={1024} priority className={styles.logo} />
      </div>
      <MoovuLoadingScene />
      <h1 className={styles.heading}>Your Kasi Ride.</h1>
      <p className={styles.message} role="status" aria-live="polite" aria-atomic="true">{message}</p>
      <div className={styles.track} aria-hidden="true"><span /></div>
    </div>
  </section>;
}
