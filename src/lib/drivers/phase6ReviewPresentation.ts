// @ts-expect-error Node strip-types tests require the explicit extension.
import { PHASE6_REQUIRED, PHASE6_REQUIRED_FIELDS, PHASE6_SECTIONS, type Phase6Draft, type Phase6Section } from "./phase6Policy.ts";
// @ts-expect-error Node strip-types tests require the explicit extension.
import { PHASE6_NEEDS_REVIEW } from "../admin/applicationSummary.ts";

export const PHASE6_EVIDENCE_LABELS: Record<string, string> = {
  id_document: "SA ID",
  drivers_license: "Driver's Licence",
  pdp: "PDP",
  vehicle_license_disc: "Vehicle Licence Disc",
  insurance: "Insurance",
  front: "Front of Vehicle",
  rear: "Rear of Vehicle",
  driver_side: "Driver Side",
  passenger_side: "Passenger Side",
  front_interior: "Front Interior",
  rear_interior: "Rear Interior",
  odometer: "Odometer",
  vin: "VIN",
  engine: "Engine Number",
};

export type ReviewUpload = {
  id: string;
  application_id?: string;
  section: string;
  state: string;
  source?: string;
  created_at?: string;
};

export type EvidenceItem = {
  section: Phase6Section;
  requirement: string;
  label: string;
  required: boolean;
  upload: ReviewUpload | null;
};

export function reviewDraft(applicationDraft: Phase6Draft, versions: { version: number; snapshot: unknown }[], currentVersion: number): Phase6Draft {
  const snapshot = versions.find(item => item.version === currentVersion)?.snapshot;
  if (snapshot && typeof snapshot === "object" && "draft" in snapshot && snapshot.draft && typeof snapshot.draft === "object") return snapshot.draft as Phase6Draft;
  return applicationDraft;
}

export function evidenceItems(draft: Phase6Draft, uploads: ReviewUpload[]): EvidenceItem[] {
  const byId = new Map(uploads.filter(upload => upload.state === "VALIDATED").map(upload => [upload.id, upload]));
  return PHASE6_SECTIONS.flatMap(section => {
    const refs = draft[section]?.evidence;
    const evidence = refs && typeof refs === "object" && !Array.isArray(refs) ? refs as Record<string, unknown> : {};
    const required = PHASE6_REQUIRED[section] as readonly string[];
    const optional = section === "driving" ? ["pdp"] : section === "vehicle" ? ["insurance"] : [];
    return [...required, ...optional].map(requirement => {
      const id = evidence[requirement];
      const upload = typeof id === "string" ? byId.get(id) : undefined;
      return { section, requirement, label: PHASE6_EVIDENCE_LABELS[requirement], required: required.includes(requirement), upload: upload?.section === section ? upload : null };
    });
  });
}

export function reviewCompletion(draft: Phase6Draft, uploads: ReviewUpload[]) {
  const items = evidenceItems(draft, uploads).filter(item => item.required);
  const fieldTotal = PHASE6_SECTIONS.reduce((count, section) => count + PHASE6_REQUIRED_FIELDS[section].length, 0);
  const fieldsPresent = PHASE6_SECTIONS.reduce((count, section) => count + PHASE6_REQUIRED_FIELDS[section].filter(field => String(draft[section]?.[field] ?? "").trim()).length, 0);
  const received = fieldsPresent + items.filter(item => item.upload).length;
  const total = fieldTotal + items.length;
  return { received, total, missing: total - received };
}

export type QueueGroup = "review" | "driver" | "draft" | "approved" | "rejected";
export function queueGroup(status: string): QueueGroup {
  if (PHASE6_NEEDS_REVIEW.some(value => value === status)) return "review";
  if (status === "CORRECTION_REQUESTED") return "driver";
  if (status === "APPROVED") return "approved";
  if (status === "REJECTED") return "rejected";
  return "draft";
}

export function queueStatus(status: string) {
  const labels: Record<string, string> = {
    DRAFT: "Draft — Driver has not submitted",
    SUBMITTED: "Needs review",
    RESUBMITTED: "Needs review",
    UNDER_REVIEW: "Review in progress",
    CORRECTION_REQUESTED: "Needs Driver action",
    APPROVED: "Approved",
    REJECTED: "Rejected",
  };
  return labels[status] ?? "Status unavailable";
}
