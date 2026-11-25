// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types test runner requires explicit TypeScript extensions.
import { phase6MissingRequirements, type Phase6Draft } from "./phase6Policy.ts";

export type ApplicationNudge = {
  tone: "info" | "warning";
  title: string;
  body: string;
  missing: string[];
  action: string;
};

const LABELS: Record<string, string> = {
  id_document: "ID document (photo)",
  drivers_license: "Driver's licence (photo)",
  vehicle_license_disc: "Vehicle licence disc (photo)",
  front: "Vehicle photo: front",
  rear: "Vehicle photo: rear",
  driver_side: "Vehicle photo: driver side",
  passenger_side: "Vehicle photo: passenger side",
  front_interior: "Vehicle photo: front interior",
  rear_interior: "Vehicle photo: rear interior",
  odometer: "Odometer photo",
  vin: "VIN photo",
  engine: "Engine number photo",
  first_name: "First name", last_name: "Last name", phone: "Phone number", id_number: "SA ID number",
  home_address: "Home address", area_name: "Area", emergency_contact_name: "Emergency contact name",
  emergency_contact_phone: "Emergency contact phone", license_number: "Licence number",
  license_code: "Licence code", license_expiry: "Licence expiry date", vehicle_make: "Vehicle make",
  vehicle_model: "Vehicle model", vehicle_color: "Vehicle colour", vehicle_registration: "Registration number",
  vehicle_year: "Vehicle year", vehicle_vin: "VIN number", vehicle_engine_number: "Engine number",
  seating_capacity: "Number of seats",
};

export function requirementLabel(key: string) {
  return LABELS[key] ?? key.replace(/_/g, " ");
}

/** What a driver should see about their (new) onboarding application. Null = nothing to show. */
export function applicationNudge(
  application: { status: string; draft?: Phase6Draft | null } | null,
  correctionTargets: string[] = [],
): ApplicationNudge | null {
  if (!application) {
    return {
      tone: "warning",
      title: "Please complete the new MOOVU driver application",
      body: "Your account was created on our older sign-up system. Complete the new application so your documents are up to date. You can keep going online in the meantime.",
      missing: [],
      action: "Start new application",
    };
  }
  const status = application.status;
  if (status === "APPROVED") return null;
  if (status === "DRAFT") {
    const missing = Object.values(phase6MissingRequirements(application.draft ?? {})).flat().map(requirementLabel);
    return {
      tone: "warning",
      title: missing.length ? `${missing.length} item${missing.length === 1 ? "" : "s"} left to finish your application` : "Your application is ready to submit",
      body: missing.length ? "Upload or fill in the following, then submit:" : "Everything is filled in. Open your application and tap Submit.",
      missing,
      action: missing.length ? "Continue application" : "Submit application",
    };
  }
  if (status === "CORRECTION_REQUESTED") {
    return {
      tone: "warning",
      title: "Your application needs corrections",
      body: correctionTargets.length ? "Please fix the following and resubmit:" : "Open your application to see what needs to change.",
      missing: correctionTargets.map(requirementLabel),
      action: "Fix and resubmit",
    };
  }
  if (["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"].includes(status)) {
    return { tone: "info", title: "Application under review", body: "We're reviewing your documents. We'll notify you when it's done.", missing: [], action: "View application" };
  }
  if (status === "REJECTED") {
    return { tone: "warning", title: "Application not approved", body: "Open your application to see the reason and next steps.", missing: [], action: "View application" };
  }
  return null;
}
