import AdminPayoutRequests from "@/components/finance/AdminPayoutRequests";
import OnlinePayoutsPanel from "@/components/finance/OnlinePayoutsPanel";

export default function AdminOnlinePayoutsPage() {
  return <main className="ad-page moovu-admin-finance-page">
    <header className="ad-head"><h1>Driver payouts</h1><p>Drivers ask to be paid their card-trip earnings (from R50). Pay them by PayShap, then mark the request as paid.</p></header>
    <AdminPayoutRequests />
    <details className="moovu-card p-4">
      <summary className="cursor-pointer font-bold">Older batch payouts</summary>
      <div className="mt-4"><OnlinePayoutsPanel role="admin" /></div>
    </details>
  </main>;
}
