export const MOOVU_SUPPORT_EMAIL = "admin@moovurides.co.za";
export const MOOVU_LEGAL_VERSION = "2026-05-05";
export const MOOVU_WEBSITE_URL = "https://moovurides.co.za";

export type LegalAcceptanceStatus = {
  termsAccepted: boolean;
  privacyAccepted: boolean;
  termsVersion: string | null;
  privacyVersion: string | null;
  acceptedAt: string | null;
  accepted: boolean;
};

function readString(source: Record<string, unknown> | null | undefined, key: string) {
  const value = source?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function getLegalAcceptanceStatus(
  userMetadata?: Record<string, unknown> | null,
  customerRecord?: Record<string, unknown> | null,
): LegalAcceptanceStatus {
  const termsAcceptedAt =
    readString(customerRecord, "terms_accepted_at") ||
    readString(userMetadata, "terms_accepted_at");
  const privacyAcceptedAt =
    readString(customerRecord, "privacy_accepted_at") ||
    readString(userMetadata, "privacy_accepted_at");
  const termsVersion =
    readString(customerRecord, "terms_version") ||
    readString(userMetadata, "terms_version");
  const privacyVersion =
    readString(customerRecord, "privacy_version") ||
    readString(userMetadata, "privacy_version");

  const termsAccepted = Boolean(termsAcceptedAt && termsVersion === MOOVU_LEGAL_VERSION);
  const privacyAccepted = Boolean(privacyAcceptedAt && privacyVersion === MOOVU_LEGAL_VERSION);

  return {
    termsAccepted,
    privacyAccepted,
    termsVersion,
    privacyVersion,
    acceptedAt: termsAcceptedAt || privacyAcceptedAt,
    accepted: termsAccepted && privacyAccepted,
  };
}

export function buildLegalAcceptanceMetadata(source: "customer_signup" | "booking_prompt") {
  const acceptedAt = new Date().toISOString();

  return {
    terms_accepted_at: acceptedAt,
    privacy_accepted_at: acceptedAt,
    terms_version: MOOVU_LEGAL_VERSION,
    privacy_version: MOOVU_LEGAL_VERSION,
    legal_acceptance_source: source,
  };
}

export function legalVersionMatches(version: unknown) {
  return typeof version === "string" && version === MOOVU_LEGAL_VERSION;
}
