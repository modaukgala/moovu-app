export const dashboardQueues = [
  { field: "pending", label: "Pending payment proofs", href: "/admin/payment-reviews" },
  { field: "subscription", label: "Subscription proofs", href: "/admin/subscriptions?status=pending_payment_review" },
  { field: "commission", label: "Commission proofs", href: "/admin/commission-payments?status=pending_payment_review" },
  { field: "waiting", label: "Awaiting payment confirmation", href: "/admin/payment-reviews?status=waiting_confirmation" },
  { field: "yocoExceptions", label: "Yoco trip-payment exceptions", href: "/admin/online-payments#fulfilment" },
  { field: "applications", label: "Pending application reviews", href: "/admin/onboarding?status=NEEDS_REVIEW" },
] as const;

export const dashboardOperationalCards = {
  today_total_bookings: { label: "Bookings today", href: "/admin/trips?date=today" },
  today_completed_trips: { label: "Completed today", href: "/admin/trips?status=completed&date=today" },
  today_cancelled_trips: { label: "Cancelled today", href: "/admin/trips?status=cancelled&date=today" },
  active_trips: { label: "Active trips", href: "/admin/dispatch?queue=active" },
  unassigned_trips: { label: "Unassigned trips", href: "/admin/dispatch?queue=unassigned" },
  online_drivers: { label: "Online drivers", href: "/admin/drivers?online=true" },
  scheduled_due_next_hour: { label: "Due next hour", href: "/admin/trips?status=scheduled&schedule=next-hour" },
  scheduled_overdue: { label: "Scheduled overdue", href: "/admin/trips?status=scheduled&schedule=overdue" },
  scheduled_total_pending: { label: "Scheduled pending", href: "/admin/trips?status=scheduled" },
} as const;

export function countValue(value: number | null | undefined) {
  return value == null ? "Unavailable" : String(value);
}

export function dashboardQueueCards(financial: boolean, counts: Partial<Record<typeof dashboardQueues[number]["field"], number | null>>) {
  return financial ? dashboardQueues.map(card => ({ ...card, value: countValue(counts[card.field]) })) : [];
}
