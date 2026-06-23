export type DriverValidationSeverity = "ready" | "warning" | "blocked";

export type DriverValidationIssue = {
  field: string;
  label: string;
  message: string;
  severity: DriverValidationSeverity;
};

export type DriverValidationInput = {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
  id_number?: string | null;
  home_address?: string | null;
  area_name?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  license_number?: string | null;
  license_code?: string | null;
  license_expiry?: string | null;
  pdp_number?: string | null;
  pdp_expiry?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: string | number | null;
  vehicle_color?: string | null;
  vehicle_registration?: string | null;
  vehicle_vin?: string | null;
  vehicle_engine_number?: string | null;
  seating_capacity?: string | number | null;
  status?: string | null;
  verification_status?: string | null;
  profile_completed?: boolean | null;
  is_deleted?: boolean | null;
};

export const DRIVER_REQUIRED_DOCUMENT_TYPES = [
  "id_document",
  "drivers_license",
  "proof_of_residence",
  "profile_photo",
] as const;

export type DriverDocumentStatusInput = {
  document_type?: string | null;
  doc_type?: string | null;
  status?: string | null;
  review_status?: string | null;
  expires_on?: string | null;
  expires_at?: string | null;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeDriverEmail(value: unknown) {
  return clean(value).toLowerCase();
}

export function normalizeSaPhone(value: unknown) {
  const raw = clean(value).replace(/[\s()-]/g, "");
  if (!raw) return "";
  if (raw.startsWith("+27")) return `0${raw.slice(3)}`;
  if (raw.startsWith("27")) return `0${raw.slice(2)}`;
  return raw;
}

export function normalizeVehicleRegistration(value: unknown) {
  return clean(value).toUpperCase().replace(/\s+/g, " ");
}

export function normalizeVin(value: unknown) {
  return clean(value).toUpperCase().replace(/\s+/g, "");
}

export function normalizeEngineNumber(value: unknown) {
  return clean(value).toUpperCase().replace(/\s+/g, "");
}

export function isValidSaIdNumber(value: unknown) {
  return /^\d{13}$/.test(clean(value));
}

export function isValidSaMobile(value: unknown) {
  return /^0[6-8][0-9]{8}$/.test(normalizeSaPhone(value));
}

export function isValidEmail(value: unknown) {
  const email = normalizeDriverEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidVin(value: unknown) {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(normalizeVin(value));
}

export function isValidEngineNumber(value: unknown) {
  return /^[A-Z0-9]{6,25}$/.test(normalizeEngineNumber(value));
}

export function isValidVehicleRegistration(value: unknown) {
  const plate = normalizeVehicleRegistration(value);
  return /^[A-Z0-9 -]{3,15}$/.test(plate);
}

export function isValidVehicleYear(value: unknown) {
  const year = Number(value);
  const currentYear = new Date().getFullYear();
  return Number.isInteger(year) && year >= 1995 && year <= currentYear + 1;
}

export function isValidSeatingCapacity(value: unknown) {
  const seats = Number(value);
  return Number.isInteger(seats) && seats >= 3 && seats <= 7;
}

export function isFutureDate(value: unknown) {
  const raw = clean(value);
  if (!raw) return false;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) && ms > Date.now();
}

export function daysUntil(value: unknown) {
  const raw = clean(value);
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000));
}

export function normalizeDriverProfileInput<T extends Record<string, unknown>>(input: T) {
  return {
    ...input,
    phone: normalizeSaPhone(input.phone),
    alt_phone: input.alt_phone ? normalizeSaPhone(input.alt_phone) : null,
    email: input.email ? normalizeDriverEmail(input.email) : input.email,
    emergency_contact_phone: normalizeSaPhone(input.emergency_contact_phone),
    vehicle_registration: normalizeVehicleRegistration(input.vehicle_registration),
    vehicle_vin: normalizeVin(input.vehicle_vin),
    vehicle_engine_number: normalizeEngineNumber(input.vehicle_engine_number),
  };
}

function issue(field: string, label: string, message: string, severity: DriverValidationSeverity = "blocked"): DriverValidationIssue {
  return { field, label, message, severity };
}

export function validateDriverProfileFields(input: DriverValidationInput, options: { requirePdp?: boolean } = {}) {
  const issues: DriverValidationIssue[] = [];
  const requirePdp = options.requirePdp ?? true;

  if (!clean(input.first_name)) issues.push(issue("first_name", "First name", "First name is required."));
  if (!clean(input.last_name)) issues.push(issue("last_name", "Last name", "Last name is required."));
  if (!isValidSaMobile(input.phone)) issues.push(issue("phone", "Phone", "Enter a valid South African mobile number."));
  if (!isValidEmail(input.email)) issues.push(issue("email", "Email", "Enter a valid email address."));
  if (!isValidSaIdNumber(input.id_number)) issues.push(issue("id_number", "ID number", "SA ID number must be exactly 13 digits."));
  if (!clean(input.home_address)) issues.push(issue("home_address", "Home address", "Residential address is required."));
  if (!clean(input.area_name)) issues.push(issue("area_name", "Area / township", "Operating area is required."));
  if (!clean(input.emergency_contact_name)) issues.push(issue("emergency_contact_name", "Emergency contact", "Emergency contact name is required."));
  if (!isValidSaMobile(input.emergency_contact_phone)) {
    issues.push(issue("emergency_contact_phone", "Emergency phone", "Enter a valid emergency contact number."));
  }
  if (!clean(input.license_number)) issues.push(issue("license_number", "Licence number", "Driver licence number is required."));
  if (!clean(input.license_code)) issues.push(issue("license_code", "Licence code", "Driver licence code is required."));
  if (!isFutureDate(input.license_expiry)) issues.push(issue("license_expiry", "Licence expiry", "Driver licence must have a valid future expiry date."));
  if (requirePdp) {
    if (!clean(input.pdp_number)) issues.push(issue("pdp_number", "PDP / PrDP", "PDP / PrDP number is required before approval."));
    if (!isFutureDate(input.pdp_expiry)) issues.push(issue("pdp_expiry", "PDP / PrDP expiry", "PDP / PrDP must have a valid future expiry date."));
  } else if (!clean(input.pdp_number)) {
    issues.push(issue("pdp_number", "PDP / PrDP", "PDP / PrDP not available yet.", "warning"));
  }
  if (!clean(input.vehicle_make)) issues.push(issue("vehicle_make", "Vehicle make", "Vehicle make is required."));
  if (!clean(input.vehicle_model)) issues.push(issue("vehicle_model", "Vehicle model", "Vehicle model is required."));
  if (!isValidVehicleYear(input.vehicle_year)) issues.push(issue("vehicle_year", "Vehicle year", "Vehicle year must be between 1995 and next year."));
  if (!clean(input.vehicle_color)) issues.push(issue("vehicle_color", "Vehicle colour", "Vehicle colour is required."));
  if (!isValidVehicleRegistration(input.vehicle_registration)) {
    issues.push(issue("vehicle_registration", "Number plate", "Number plate must be 3 to 15 letters/numbers, spaces, or hyphens."));
  }
  if (!isValidVin(input.vehicle_vin)) issues.push(issue("vehicle_vin", "VIN", "VIN must be exactly 17 characters and cannot contain I, O, or Q."));
  if (!isValidEngineNumber(input.vehicle_engine_number)) {
    issues.push(issue("vehicle_engine_number", "Engine number", "Engine number must be 6 to 25 uppercase letters/numbers."));
  }
  if (!isValidSeatingCapacity(input.seating_capacity)) issues.push(issue("seating_capacity", "Seating capacity", "Seating capacity must be between 3 and 7."));
  if (input.is_deleted) issues.push(issue("is_deleted", "Driver record", "Deleted drivers cannot be approved."));
  if (input.status === "suspended") issues.push(issue("status", "Driver status", "Suspended drivers cannot be approved."));

  const expiringSoon = [
    ["license_expiry", "Licence expiry", input.license_expiry],
    ["pdp_expiry", "PDP / PrDP expiry", input.pdp_expiry],
  ] as const;

  expiringSoon.forEach(([field, label, value]) => {
    const days = daysUntil(value);
    if (days !== null && days >= 0 && days <= 30) {
      issues.push(issue(field, label, `${label} expires in ${days} day(s).`, "warning"));
    }
  });

  return issues;
}

export function validateDriverDocumentsForApproval(documents: DriverDocumentStatusInput[]) {
  const issues: DriverValidationIssue[] = [];

  DRIVER_REQUIRED_DOCUMENT_TYPES.forEach((type) => {
    const match = documents.find((doc) => (doc.document_type || doc.doc_type) === type);
    if (!match) {
      issues.push(issue(`document:${type}`, "Required document", `${type.replaceAll("_", " ")} is missing.`));
      return;
    }
    const status = String(match.review_status || match.status || "").toLowerCase();
    if (!["approved", "verified"].includes(status)) {
      issues.push(issue(`document:${type}`, "Required document", `${type.replaceAll("_", " ")} is ${status || "pending review"}.`));
    }
  });

  documents.forEach((doc) => {
    const status = String(doc.review_status || doc.status || "").toLowerCase();
    if (["rejected", "needs_reupload"].includes(status)) {
      issues.push(issue(`document:${doc.document_type || doc.doc_type || "unknown"}`, "Document", "A document is rejected or needs re-upload."));
    }
  });

  return issues;
}

export function readinessScoreFromIssues(issues: DriverValidationIssue[]) {
  const blocked = issues.filter((item) => item.severity === "blocked").length;
  const warnings = issues.filter((item) => item.severity === "warning").length;
  return Math.max(0, Math.round(100 - blocked * 8 - warnings * 3));
}
