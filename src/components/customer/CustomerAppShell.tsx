import type { ReactNode } from "react";
import CustomerBottomNav from "@/components/app-shell/CustomerBottomNav";

export default function CustomerAppShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`customer-app-shell ${className}`.trim()}>{children}<CustomerBottomNav /></main>;
}
