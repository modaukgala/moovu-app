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
