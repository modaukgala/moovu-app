export const SCHEDULED_RIDES_ENABLED = false;

export function phase6EligibilityEnabled(environment = process.env): boolean {
  const configured = environment.NEXT_PUBLIC_MOOVU_PHASE6_NEW_WORK_ELIGIBILITY
    ?? environment.MOOVU_PHASE6_NEW_WORK_ELIGIBILITY;
  return configured?.trim().toLowerCase() === "enabled";
}

export function phase6DriverNoticeEnabled(environment = process.env): boolean {
  return phase6EligibilityEnabled(environment);
}
