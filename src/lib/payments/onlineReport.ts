export type OnlinePaymentReportRow = {
  id: string; payer_type: 'customer' | 'driver'; payer: string; purpose: string;
  amount_cents: number; verified_at: string; provider_payment_id: string;
  provider_checkout_id: string | null; payment_ledger_transaction_id: string | null;
  trip_id: string | null; pickup_address: string | null; dropoff_address: string | null;
  settlement_reference: string; provider_event_id: string;
};
export type OnlinePaymentReport = {
  payments: OnlinePaymentReportRow[]; total: number; total_cents: number;
  trip_cents: number; commission_cents: number; page: number; limit: number;
};
export function onlineReportFilters(params: URLSearchParams) {
  const from = params.get('from'); const to = params.get('to');
  const payer = params.get('payer') ?? 'all';
  const page = Number(params.get('page') ?? '1');
  const start = Date.parse(from ?? ''); const end = Date.parse(to ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end-start > 366*86400000
    || !['all','customer','driver'].includes(payer) || !Number.isInteger(page) || page<1 || page>100000) {
    throw new Error('Invalid report filters.');
  }
  return { p_from: new Date(start).toISOString(), p_to: new Date(end).toISOString(), p_payer: payer, p_page: page, p_limit: 20 };
}
