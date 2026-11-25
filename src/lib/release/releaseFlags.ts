export const SCHEDULED_RIDES_ENABLED = false;

export function phase6EligibilityEnabled(environment: Record<string, string | undefined> = {
  NEXT_PUBLIC_MOOVU_PHASE6_NEW_WORK_ELIGIBILITY: process.env.NEXT_PUBLIC_MOOVU_PHASE6_NEW_WORK_ELIGIBILITY,
  MOOVU_PHASE6_NEW_WORK_ELIGIBILITY: process.env.MOOVU_PHASE6_NEW_WORK_ELIGIBILITY,
}): boolean {
  const configured = environment.NEXT_PUBLIC_MOOVU_PHASE6_NEW_WORK_ELIGIBILITY
    ?? environment.MOOVU_PHASE6_NEW_WORK_ELIGIBILITY;
  return configured?.trim().toLowerCase() === "enabled";
}
