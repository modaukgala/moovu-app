import { normalizeDriverDocumentType, type DriverDocumentType } from "@/lib/driver-documents";

export type DriverDocumentCheck = {
  documentType: DriverDocumentType;
  fieldName: string;
  label: string;
  manualValue: string | null;
  extractedValue: string | null;
  matchStatus: "matched" | "mismatch" | "not_found" | "needs_review";
  confidence: number | null;
};

type ProfileLike = Record<string, unknown>;

type DocumentLike = {
  document_type?: string | null;
  doc_type?: string | null;
  file_path?: string | null;
};

const CHECKS: Array<{
  documentType: DriverDocumentType;
  fieldName: string;
  label: string;
}> = [
  { documentType: "id_document", fieldName: "id_number", label: "ID / passport number" },
  { documentType: "id_document", fieldName: "first_name", label: "First name" },
  { documentType: "id_document", fieldName: "last_name", label: "Last name" },
  { documentType: "drivers_license", fieldName: "license_number", label: "Licence number" },
  { documentType: "drivers_license", fieldName: "license_expiry", label: "Licence expiry" },
  { documentType: "pdp", fieldName: "pdp_number", label: "PDP / PrDP number" },
  { documentType: "pdp", fieldName: "pdp_expiry", label: "PDP / PrDP expiry" },
  { documentType: "vehicle_registration", fieldName: "vehicle_vin", label: "VIN" },
  { documentType: "vehicle_registration", fieldName: "vehicle_engine_number", label: "Engine number" },
  { documentType: "vehicle_registration", fieldName: "vehicle_registration", label: "Number plate" },
  { documentType: "roadworthy_certificate", fieldName: "vehicle_registration", label: "Roadworthy plate" },
];

function clean(value: unknown) {
  const text = String(value ?? "").trim();
  return text.length ? text : null;
}

export function buildDriverDocumentChecks(profile: ProfileLike, documents: DocumentLike[]): DriverDocumentCheck[] {
  return CHECKS.map((check) => {
    const hasDocument = documents.some(
      (doc) =>
        normalizeDriverDocumentType(doc.document_type || doc.doc_type) === check.documentType &&
        Boolean(doc.file_path),
    );

    return {
      documentType: check.documentType,
      fieldName: check.fieldName,
      label: check.label,
      manualValue: clean(profile[check.fieldName]),
      extractedValue: null,
      matchStatus: hasDocument ? "needs_review" : "not_found",
      confidence: null,
    };
  });
}
