export const CUSTOMER_ACTIVE_STATUSES = ['requested','offered','assigned','arrived','ongoing'] as const;
export function isCustomerRecoveryEntry(path: string) { return path==='/' || path==='/book'; }
export function customerResumeDestination(trip: {id:string;payment_method:string|null}, paid:boolean) {
  return trip.payment_method?.toLowerCase()==='online'&&!paid
    ? `/payment/success?tripId=${encodeURIComponent(trip.id)}`
    : `/ride/${encodeURIComponent(trip.id)}`;
}
