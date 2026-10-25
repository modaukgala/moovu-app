import OnlinePayoutsPanel from "@/components/finance/OnlinePayoutsPanel";

export default function AdminOnlinePayoutsPage() {
  return <main className="moovu-admin-finance-page space-y-5 p-4 sm:p-6">
    <h1 className="text-2xl font-black text-slate-950">Driver Payouts</h1>
    <OnlinePayoutsPanel role="admin" />
  </main>;
}
