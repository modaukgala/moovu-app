import type { SupabaseClient } from "@supabase/supabase-js";

export const DRIVER_DOCUMENT_TYPES = [
  "id_document",
  "drivers_license",
  "proof_of_residence",
  "profile_photo",
  "pdp",
  "police_clearance",
  "transport_permit",
  "vehicle_registration",
  "vehicle_license_disc",
  "roadworthy_certificate",
  "vehicle_photos",
  "insurance_document",
  "other",
] as const;

export type DriverDocumentType = (typeof DRIVER_DOCUMENT_TYPES)[number];

export type DriverDocumentItem = {
  label: string;
  type: DriverDocumentType;
  required?: boolean;
};

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const DOCUMENT_TYPE_SET = new Set<string>(DRIVER_DOCUMENT_TYPES);

export const DRIVER_DOCUMENT_LABELS: Record<DriverDocumentType, string> = {
  id_document: "SA ID or passport",
  drivers_license: "Driver licence",
  proof_of_residence: "Proof of residence",
  profile_photo: "Profile photo",
  pdp: "PDP / PrDP",
  police_clearance: "Police clearance",
  transport_permit: "Transport permit",
  vehicle_registration: "Vehicle registration",
  vehicle_license_disc: "Licence disc",
  roadworthy_certificate: "Roadworthy certificate",
  vehicle_photos: "Vehicle photos",
  insurance_document: "Insurance proof",
  other: "Other document",
};

const DOCUMENT_TYPE_ALIASES: Record<string, DriverDocumentType> = {
  "sa id or passport": "id_document",
  id: "id_document",
  id_document: "id_document",
  "id-document": "id_document",
  passport: "id_document",
  license: "drivers_license",
  licence: "drivers_license",
  "driver licence": "drivers_license",
  "driver license": "drivers_license",
  drivers_license: "drivers_license",
  "drivers-license": "drivers_license",
  proof_of_residence: "proof_of_residence",
  "proof-of-residence": "proof_of_residence",
  "proof of residence": "proof_of_residence",
  "profile photo": "profile_photo",
  profile_photo: "profile_photo",
  "profile-photo": "profile_photo",
  pdp: "pdp",
  prdp: "pdp",
  "pdp / prdp": "pdp",
  "pdp/prdp": "pdp",
  police_clearance: "police_clearance",
  "police-clearance": "police_clearance",
  "police clearance": "police_clearance",
  transport_permit: "transport_permit",
  "transport-permit": "transport_permit",
  "transport permit": "transport_permit",
  vehicle_registration: "vehicle_registration",
  "vehicle-registration": "vehicle_registration",
  "vehicle registration": "vehicle_registration",
  vehicle_reg: "vehicle_registration",
  "registration": "vehicle_registration",
  vehicle_license_disc: "vehicle_license_disc",
  "vehicle-license-disc": "vehicle_license_disc",
  "licence disc": "vehicle_license_disc",
  "license disc": "vehicle_license_disc",
  roadworthy_certificate: "roadworthy_certificate",
  "roadworthy-certificate": "roadworthy_certificate",
  "roadworthy certificate": "roadworthy_certificate",
  roadworthy: "roadworthy_certificate",
  vehicle_photos: "vehicle_photos",
  "vehicle-photos": "vehicle_photos",
  "vehicle photos": "vehicle_photos",
  "vehicle photo": "vehicle_photos",
  "vehicle photo - front": "vehicle_photos",
  "vehicle photo - back": "vehicle_photos",
  "vehicle photo - left side": "vehicle_photos",
  "vehicle photo - right side": "vehicle_photos",
  "vehicle photo - interior": "vehicle_photos",
  "vehicle photo - number plate": "vehicle_photos",
  insurance: "insurance_document",
  "insurance proof": "insurance_document",
  insurance_document: "insurance_document",
  "insurance-document": "insurance_document",
  other: "other",
};

const LEGACY_DOCUMENT_TYPE_VALUES: Partial<Record<DriverDocumentType, string>> = {
  id_document: "id",
  drivers_license: "license",
  pdp: "prdp",
  vehicle_registration: "vehicle_reg",
  insurance_document: "insurance",
};

const LEGACY_DISPLAY_DOCUMENT_TYPE_VALUES: Partial<Record<DriverDocumentType, string>> = {
  id_document: "SA ID or passport",
  drivers_license: "Driver licence",
  proof_of_residence: "Proof of residence",
  profile_photo: "Profile photo",
  pdp: "PDP / PrDP",
  police_clearance: "Police clearance",
  transport_permit: "Transport permit",
  vehicle_registration: "Vehicle registration",
  vehicle_license_disc: "Licence disc",
  roadworthy_certificate: "Roadworthy certificate",
  vehicle_photos: "Vehicle photos",
  insurance_document: "Insurance proof",
};

function cleanKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeDriverDocumentType(value: unknown): DriverDocumentType {
  const raw = String(value ?? "").trim();
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (DOCUMENT_TYPE_SET.has(normalized)) return normalized as DriverDocumentType;
  return DOCUMENT_TYPE_ALIASES[cleanKey(raw)] ?? DOCUMENT_TYPE_ALIASES[normalized] ?? "other";
}

export function getDriverDocumentLabel(value: unknown) {
  return DRIVER_DOCUMENT_LABELS[normalizeDriverDocumentType(value)];
}

function safeSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

function getMissingColumn(error: { message?: string } | null | undefined) {
  const message = String(error?.message ?? "");
  return message.match(/column "([^"]+)"/i)?.[1] ?? message.match(/'([^']+)' column/i)?.[1] ?? null;
}

async function writeMetadata(
  supabase: SupabaseClient,
  mode: "insert" | "update",
  rows: Record<string, unknown>[],
  existingId?: string
) {
  let lastError: { message?: string; code?: string } | null = null;

  for (const row of rows) {
    let nextRow = { ...row };

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const query =
        mode === "update" && existingId
          ? supabase.from("driver_documents").update(nextRow).eq("id", existingId)
          : supabase.from("driver_documents").insert(nextRow);

      const { error } = await query;
      if (!error) return { ok: true as const };

      lastError = error;

      if (error.code === "42703") {
        const missingColumn = getMissingColumn(error);
        if (missingColumn && missingColumn in nextRow) {
          const rest = { ...nextRow };
          delete rest[missingColumn];
          nextRow = rest;
          continue;
        }
      }

      break;
    }
  }

  return { ok: false as const, error: lastError ?? { message: "Could not match driver_documents schema." } };
}

function metadataVariants(params: {
  driverId: string;
  documentType: DriverDocumentType;
  path: string;
  uploadedBy?: string | null;
  required: boolean;
  source: string;
  expiresOn?: string | null;
  now: string;
}) {
  const base: Record<string, unknown> = {
    driver_id: params.driverId,
    document_type: params.documentType,
    doc_type: params.documentType,
    file_path: params.path,
    status: "pending",
    review_status: "pending",
    rejection_reason: null,
    uploaded_at: params.now,
    updated_at: params.now,
    uploaded_by: params.uploadedBy || null,
    source: params.source,
    required: params.required,
    expires_on: params.expiresOn || null,
  };

  const minimal = {
    driver_id: params.driverId,
    document_type: params.documentType,
    doc_type: params.documentType,
    file_path: params.path,
    status: "pending",
    review_status: "pending",
    uploaded_at: params.now,
  };

  const variants: Record<string, unknown>[] = [
    base,
    { ...base, status: "uploaded" },
    minimal,
    { ...minimal, status: "uploaded" },
    {
      driver_id: params.driverId,
      document_type: params.documentType,
      doc_type: params.documentType,
      file_path: params.path,
      status: "pending",
      uploaded_at: params.now,
    },
  ];

  const legacyType = LEGACY_DOCUMENT_TYPE_VALUES[params.documentType];
  if (legacyType) {
    variants.push(
      { ...minimal, document_type: legacyType, doc_type: legacyType },
      { ...minimal, document_type: params.documentType, doc_type: legacyType },
      { ...minimal, document_type: legacyType, doc_type: params.documentType }
    );
  }

  const displayType = LEGACY_DISPLAY_DOCUMENT_TYPE_VALUES[params.documentType];
  if (displayType) {
    variants.push(
      { ...minimal, document_type: displayType, doc_type: displayType },
      { ...minimal, document_type: params.documentType, doc_type: displayType },
      { ...minimal, document_type: displayType, doc_type: params.documentType }
    );
  }

  return variants;
}

async function findExistingDocument(
  supabase: SupabaseClient,
  driverId: string,
  documentType: DriverDocumentType
) {
  const byDocumentType = await supabase
    .from("driver_documents")
    .select("id")
    .eq("driver_id", driverId)
    .eq("document_type", documentType)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!byDocumentType.error) return byDocumentType.data?.id ? String(byDocumentType.data.id) : null;

  const byDocType = await supabase
    .from("driver_documents")
    .select("id")
    .eq("driver_id", driverId)
    .eq("doc_type", documentType)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!byDocType.error) return byDocType.data?.id ? String(byDocType.data.id) : null;
  return null;
}

export async function uploadDriverDocument({
  supabase,
  driverId,
  documentType,
  file,
  uploadedBy,
  required = false,
  source = "driver",
  expiresOn,
}: {
  supabase: SupabaseClient;
  driverId: string;
  documentType: unknown;
  file: File;
  uploadedBy?: string | null;
  required?: boolean;
  source?: "driver" | "admin" | "application" | "profile";
  expiresOn?: string | null;
}) {
  const normalizedType = normalizeDriverDocumentType(documentType);

  if (!driverId) {
    return { ok: false as const, error: "Driver account is not linked yet." };
  }

  if (!file) {
    return { ok: false as const, error: "Choose a document to upload." };
  }

  if (file.size > MAX_FILE_BYTES) {
    return { ok: false as const, error: "File must be 8MB or smaller." };
  }

  if (file.type && !ALLOWED_FILE_TYPES.has(file.type)) {
    return { ok: false as const, error: "Upload a PDF, JPG, PNG, or WEBP file." };
  }

  const driverExists = await supabase.from("drivers").select("id").eq("id", driverId).maybeSingle();
  if (driverExists.error || !driverExists.data?.id) {
    return { ok: false as const, error: "Driver account could not be verified." };
  }

  const extension = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `drivers/${driverId}/${normalizedType}/${Date.now()}.${safeSegment(extension || "bin")}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage.from("driver-docs").upload(path, bytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (uploadError) {
    console.error("[driver-doc-upload] storage upload failed", {
      driverId,
      documentType: normalizedType,
      message: uploadError.message,
    });
    return { ok: false as const, error: "We could not upload this document. Please try again." };
  }

  const now = new Date().toISOString();
  const metadata = metadataVariants({
    driverId,
    documentType: normalizedType,
    path,
    uploadedBy,
    required,
    source,
    expiresOn,
    now,
  });

  const existingId = await findExistingDocument(supabase, driverId, normalizedType);
  const result = existingId
    ? await writeMetadata(supabase, "update", metadata, existingId)
    : await writeMetadata(supabase, "insert", metadata);

  if (!result.ok) {
    await supabase.storage.from("driver-docs").remove([path]).catch(() => {});
    console.error("[driver-doc-upload] metadata save failed", {
      driverId,
      documentType: normalizedType,
      message: result.error?.message,
      code: "code" in result.error ? result.error.code : undefined,
    });
    return { ok: false as const, error: "We could not save this document. Please try again." };
  }

  return { ok: true as const, path, documentType: normalizedType };
}
