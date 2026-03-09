import Link from "next/link";
import { ReactNode } from "react";

export default function AdminProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-[260px] border-r p-4">
        <div className="mb-6">
          <div className="text-xl font-semibold">Moovu Admin</div>
          <div className="text-sm opacity-70">Kasi Rides Ops Console</div>
        </div>

        <nav className="flex flex-col gap-3">
          <Link className="border rounded-xl px-4 py-3 hover:opacity-90" href="/admin">
            Dashboard
          </Link>

          <Link className="border rounded-xl px-4 py-3 hover:opacity-90" href="/admin/drivers">
            Drivers
          </Link>

          <Link className="border rounded-xl px-4 py-3 hover:opacity-90" href="/admin/trips">
            Trips
          </Link>

          <Link className="border rounded-xl px-4 py-3 hover:opacity-90" href="/admin/pricing">
            Pricing
          </Link>

          <Link className="border rounded-xl px-4 py-3 hover:opacity-90" href="/admin/reports">
            Reports
          </Link>

          <Link className="border rounded-xl px-4 py-3 hover:opacity-90" href="/admin/applications">
            Applications
          </Link>

          <Link className="border rounded-xl px-4 py-3 hover:opacity-90" href="/admin/link-driver">
            Link Driver
          </Link>

          <Link className="border rounded-xl px-4 py-3 hover:opacity-90" href="/admin/dispatch/map">
            Driver Map
          </Link> 

          <Link className="border rounded-xl px-4 py-3 hover:opacity-90" href="/admin/subscriptions">
            Subscriptions
          </Link>

          <Link className="border rounded-xl px-4 py-3 hover:opacity-90" href="/admin/reports/driver-earnings">
            Earnings Report
          </Link>

          <Link className="border rounded-xl px-4 py-3 hover:opacity-90" href="/admin/logout">
            Logout
          </Link>
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1">{children}</main>
    </div>
  );
}