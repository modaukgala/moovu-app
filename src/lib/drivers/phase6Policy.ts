export const PHASE6_SECTIONS = ["personal", "driving", "vehicle", "scanner"] as const;
export type Phase6Section = typeof PHASE6_SECTIONS[number];
export const PHASE6_CHECKLIST = ["front", "rear", "driver_side", "passenger_side", "front_interior", "rear_interior", "odometer", "vin", "engine"] as const;
export const PHASE6_REQUIRED = { personal: ["id_document"], driving: ["drivers_license"], vehicle: ["vehicle_license_disc"], scanner: [...PHASE6_CHECKLIST] };
export type Phase6Draft = Partial<Record<Phase6Section, Record<string, unknown>>>;
export type Phase6Application = { id: string; driver_id: string; cycle: number; revision: number; version: number; status: string; draft: Phase6Draft; correction_sections: string[] };
export function phase6Editable(application: Phase6Application, section: Phase6Section) {
  return application.status === "DRAFT" || application.status === "CORRECTION_REQUESTED" && application.correction_sections.includes(section);
}
export function phase6PdpNotice(draft: Phase6Draft) {
  const evidence = draft.driving?.evidence as Record<string, string> | undefined;
  return evidence?.pdp ? "PDP evidence provided — verification pending or recorded by Admin." : "PDP must be obtained/provided by 30 November 2026. Completing onboarding does not establish legal permission to operate.";
}
export function validSaIdentity(value: unknown) {
  const text = String(value ?? "");
  if (!/^\d{13}$/.test(text)) return false;
  const yy = Number(text.slice(0, 2)), month = Number(text.slice(2, 4)), day = Number(text.slice(4, 6));
  const current = new Date().getFullYear();
  const year = yy + (yy > current % 100 ? 1900 : 2000);
  const dob = new Date(Date.UTC(year, month - 1, day));
  if (dob.getUTCFullYear() !== year || dob.getUTCMonth() !== month - 1 || dob.getUTCDate() !== day || dob.getTime() > Date.now()) return false;
  let total = 0;
  for (let i = 0; i < 13; i++) { let n = Number(text[i]); if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } total += n; }
  return total % 10 === 0;
}
export function phase6Evidence(draft: Phase6Draft, section: Phase6Section): Record<string, string> {
  const evidence = draft[section]?.evidence;
  return evidence && typeof evidence === "object" && !Array.isArray(evidence) ? evidence as Record<string, string> : {};
}
export const PHASE6_FIELDS: Record<Phase6Section, readonly string[]> = {
  personal: ["first_name", "last_name", "phone", "id_number", "home_address", "area_name", "emergency_contact_name", "emergency_contact_phone", "evidence"],
  driving: ["license_number", "license_code", "license_expiry", "pdp_number", "pdp_expiry", "evidence"],
  vehicle: ["vehicle_make", "vehicle_model", "vehicle_color", "vehicle_registration", "vehicle_year", "vehicle_vin", "vehicle_engine_number", "seating_capacity", "vehicle_license_expiry", "insurance_expiry", "evidence"],
  scanner: ["provider", "condition_notes", "evidence"],
};
export function phase6DraftShape(payload: unknown): payload is Phase6Draft {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return Object.entries(payload).every(([section, data]) => {
    if (!PHASE6_SECTIONS.includes(section as Phase6Section) || !data || typeof data !== "object" || Array.isArray(data)) return false;
    return Object.entries(data).every(([key, value]) => {
      if (!PHASE6_FIELDS[section as Phase6Section].includes(key)) return false;
      if (key !== "evidence") return typeof value === "string" && value.length <= (key === "condition_notes" ? 2000 : 200);
      const allowed = [...PHASE6_REQUIRED[section as Phase6Section], ...(section === "driving" ? ["pdp"] : section === "vehicle" ? ["insurance"] : [])];
      return !!value && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([requirement, id]) => allowed.includes(requirement) && typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
    });
  });
}
