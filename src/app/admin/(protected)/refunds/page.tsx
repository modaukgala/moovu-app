import AdminRefundRequests from "@/components/finance/AdminRefundRequests";

export default function AdminRefundsPage() {
  return <main className="ad-page moovu-admin-finance-page">
    <header className="ad-head"><h1>Customer refunds</h1></header>
    <p className="text-sm text-slate-600">Customers ask for a refund on a cancelled card trip. Message them on WhatsApp for their bank details, pay them back, then record it here.</p>
    <AdminRefundRequests />
  </main>;
}
