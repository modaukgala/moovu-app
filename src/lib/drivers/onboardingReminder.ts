export type OnboardingReminder = {
  title: string;
  description: string;
  action: string;
};

export function onboardingReminder(status: string | null): OnboardingReminder | null {
  if (status === "APPROVED") return null;
  if (status === null || status === "DRAFT") {
    return {
      title: "Complete your driver application",
      description: "Finish your onboarding to keep your driver profile up to date.",
      action: "Continue application",
    };
  }
  if (["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"].includes(status)) {
    return {
      title: "Application under review",
      description: "Your application has been submitted and is awaiting review.",
      action: "View application",
    };
  }
  if (status === "CORRECTION_REQUESTED") {
    return {
      title: "Application needs corrections",
      description: "Review the requested changes and resubmit your application.",
      action: "Review corrections",
    };
  }
  if (status === "REJECTED") {
    return {
      title: "Application needs review",
      description: "Review the decision and your next steps.",
      action: "View application",
    };
  }
  return {
    title: "Check your driver application",
    description: "Review your current onboarding status.",
    action: "View application",
  };
}
