import type { ReactNode } from "react";

export default function CustomerBottomSheet({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`customer-home-sheet ${className}`.trim()}><span className="customer-sheet-handle" aria-hidden="true" />{children}</section>;
}
