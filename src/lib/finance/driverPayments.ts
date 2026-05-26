export const DRIVER_SUBSCRIPTION_PLANS = {
  day: {
    label: "Daily",
    amount: 45,
    days: 1,
  },
  week: {
    label: "Weekly",
    amount: 100,
    days: 7,
  },
  month: {
    label: "Monthly",
    amount: 250,
    days: 30,
  },
} as const;

export type DriverSubscriptionPlan = keyof typeof DRIVER_SUBSCRIPTION_PLANS;

export function isDriverSubscriptionPlan(value: string): value is DriverSubscriptionPlan {
  return value === "day" || value === "week" || value === "month";
}

export function getDriverSubscriptionAmount(plan: DriverSubscriptionPlan) {
  return DRIVER_SUBSCRIPTION_PLANS[plan].amount;
}

export function getDriverSubscriptionDays(plan: DriverSubscriptionPlan) {
  return DRIVER_SUBSCRIPTION_PLANS[plan].days;
}

function addDays(base: Date, days: number) {
  const copy = new Date(base);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function getDriverSubscriptionStartDate(
  currentExpiry: string | Date | null | undefined,
  now = new Date(),
) {
  if (!currentExpiry) return now;

  const expiry = currentExpiry instanceof Date ? currentExpiry : new Date(currentExpiry);
  if (Number.isNaN(expiry.getTime())) return now;

  return expiry.getTime() > now.getTime() ? expiry : now;
}

export function calculateDriverSubscriptionExpiry(
  currentExpiry: string | Date | null | undefined,
  plan: DriverSubscriptionPlan,
  now = new Date(),
) {
  return addDays(getDriverSubscriptionStartDate(currentExpiry, now), getDriverSubscriptionDays(plan));
}
