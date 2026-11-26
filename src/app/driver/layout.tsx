import type { ReactNode } from "react";

/** Wraps every driver page so the shared premium driver styles apply everywhere. */
export default function DriverLayout({ children }: { children: ReactNode }) {
  return <div className="dp-app">{children}</div>;
}
