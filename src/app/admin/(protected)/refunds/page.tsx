import AdminRefundRequests from "@/components/finance/AdminRefundRequests";

export default function AdminRefundsPage() {
  return <main className="moovu-admin-finance-page space-y-5 p-4 sm:p-6">
    <h1 className="text-2xl font-black text-slate-950">Customer Refunds</h1>
    <p className="text-sm text-slate-600">Customers ask for a refund on a cancelled card trip. Message them on WhatsApp for their bank details, pay them back, then record it here.</p>
    <AdminRefundRequests />
  </main>;
}
