import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DRIVER_DOCUMENTS_BUCKET,
  normalizeDriverDocumentStoragePath,
} from "./driver-document-storage";

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

export const DRIVER_DOCUMENT_MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const ALLOWED_FILE_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);
const DOCUMENT_TYPE_SET = new Set<string>(DRIVER_DOCUMENT_TYPES);

export type DriverDocumentFileDescriptor = {
  name: string;
  size: number;
  type?: string | null;
};

type DriverDocumentSource = "driver" | "admin" | "application" | "profile";

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

function fileExtension(fileName: string) {
  return safeSegment(fileName.includes(".") ? fileName.split(".").pop() || "" : "");
}

export function validateDriverDocumentFile(file: DriverDocumentFileDescriptor) {
  if (!file?.name || !Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false as const, error: "Choose a valid, non-empty document." };
  }

  if (file.size > DRIVER_DOCUMENT_MAX_FILE_BYTES) {
    return { ok: false as const, error: "File is too large. Upload a file that is 8MB or smaller." };
  }

  const extension = fileExtension(file.name);
  const mimeType = String(file.type ?? "").trim().toLowerCase();
  const mimeAllowed = !mimeType || mimeType === "application/octet-stream" || ALLOWED_FILE_TYPES.has(mimeType);

  if (!ALLOWED_FILE_EXTENSIONS.has(extension) || !mimeAllowed) {
    return { ok: false as const, error: "Unsupported file type. Upload a PDF, JPG, PNG, or WEBP file." };
  }

  return {
    ok: true as const,
    extension,
    contentType: mimeType && mimeType !== "application/octet-stream" ? mimeType : "application/octet-stream",
  };
}

function createStoragePath(driverId: string, documentType: DriverDocumentType, extension: string) {
  const uploadId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `drivers/${driverId}/${documentType}/${uploadId}.${extension}`;
}

async function verifyDriverExists(supabase: SupabaseClient, driverId: string) {
  const result = await supabase.from("drivers").select("id").eq("id", driverId).maybeSingle();
  return !result.error && Boolean(result.data?.id);
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
  required: boolean;
  expiresOn?: string | null;
  originalName: string;
  mimeType: string;
  fileSizeBytes: number;
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
    reviewed_by: null,
    reviewed_at: null,
    original_name: params.originalName,
    mime_type: params.mimeType,
    file_size_bytes: params.fileSizeBytes,
    is_required: params.required,
    expires_on: params.expiresOn || null,
    expires_at: params.expiresOn || null,
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

async function saveDriverDocumentMetadata({
  supabase,
  driverId,
  documentType,
  path,
  file,
  required,
  expiresOn,
}: {
  supabase: SupabaseClient;
  driverId: string;
  documentType: DriverDocumentType;
  path: string;
  file: DriverDocumentFileDescriptor;
  required: boolean;
  expiresOn?: string | null;
}) {
  const now = new Date().toISOString();
  const metadata = metadataVariants({
    driverId,
    documentType,
    path,
    required,
    expiresOn,
    originalName: file.name,
    mimeType: String(file.type || "application/octet-stream"),
    fileSizeBytes: file.size,
    now,
  });

  let existingId = await findExistingDocument(supabase, driverId, documentType);
  let result = existingId
    ? await writeMetadata(supabase, "update", metadata, existingId)
    : await writeMetadata(supabase, "insert", metadata);

  // A concurrent upload can create the unique driver/document row after the lookup.
  if (!result.ok && result.error?.code === "23505") {
    existingId = await findExistingDocument(supabase, driverId, documentType);
    if (existingId) result = await writeMetadata(supabase, "update", metadata, existingId);
  }

  return result;
}

export async function prepareDriverDocumentUpload({
  supabase,
  driverId,
  documentType,
  file,
}: {
  supabase: SupabaseClient;
  driverId: string;
  documentType: unknown;
  file: DriverDocumentFileDescriptor;
}) {
  if (!driverId) return { ok: false as const, error: "Driver account is not linked yet." };

  const validated = validateDriverDocumentFile(file);
  if (!validated.ok) return validated;

  const normalizedType = normalizeDriverDocumentType(documentType);
  if (!(await verifyDriverExists(supabase, driverId))) {
    return { ok: false as const, error: "Driver account could not be verified." };
  }

  const path = createStoragePath(driverId, normalizedType, validated.extension);
  const { data, error } = await supabase.storage
    .from(DRIVER_DOCUMENTS_BUCKET)
    .createSignedUploadUrl(path, { upsert: false });

  if (error || !data?.token) {
    console.error("[driver-doc-upload] signed upload preparation failed", {
      driverId,
      documentType: normalizedType,
      message: error?.message,
    });
    return { ok: false as const, error: "Storage upload could not be prepared. Please retry." };
  }

  return {
    ok: true as const,
    bucket: DRIVER_DOCUMENTS_BUCKET,
    path,
    uploadToken: data.token,
    documentType: normalizedType,
  };
}

export async function finalizeDriverDocumentUpload({
  supabase,
  driverId,
  documentType,
  path: storedPath,
  file,
  required = false,
  expiresOn,
}: {
  supabase: SupabaseClient;
  driverId: string;
  documentType: unknown;
  path: unknown;
  file: DriverDocumentFileDescriptor;
  required?: boolean;
  source?: DriverDocumentSource;
  uploadedBy?: string | null;
  expiresOn?: string | null;
}) {
  if (!driverId) return { ok: false as const, error: "Driver account is not linked yet." };

  const validated = validateDriverDocumentFile(file);
  if (!validated.ok) return validated;

  const normalizedType = normalizeDriverDocumentType(documentType);
  const path = normalizeDriverDocumentStoragePath(storedPath);
  const expectedPrefix = `drivers/${driverId}/${normalizedType}/`;

  if (!path || !path.startsWith(expectedPrefix) || path.includes("..")) {
    return { ok: false as const, error: "The uploaded document path is invalid." };
  }

  if (!(await verifyDriverExists(supabase, driverId))) {
    return { ok: false as const, error: "Driver account could not be verified." };
  }

  const slashIndex = path.lastIndexOf("/");
  const folder = path.slice(0, slashIndex);
  const fileName = path.slice(slashIndex + 1);
  const { data: objects, error: objectError } = await supabase.storage
    .from(DRIVER_DOCUMENTS_BUCKET)
    .list(folder, { limit: 10, search: fileName });
  const uploadedObject = objects?.find((object) => object.name === fileName);

  if (objectError || !uploadedObject) {
    console.error("[driver-doc-upload] uploaded object confirmation failed", {
      driverId,
      documentType: normalizedType,
      path,
      message: objectError?.message,
    });
    return { ok: false as const, error: "Storage upload could not be confirmed. Please retry." };
  }

  const objectMetadata = uploadedObject.metadata as Record<string, unknown> | null;
  const storedSize = Number(objectMetadata?.size ?? file.size);
  const storedMimeType = String(objectMetadata?.mimetype ?? file.type ?? "application/octet-stream");
  const storedFile = {
    name: file.name,
    size: Number.isFinite(storedSize) && storedSize > 0 ? storedSize : file.size,
    type: storedMimeType,
  };
  const storedValidation = validateDriverDocumentFile(storedFile);

  if (!storedValidation.ok) {
    await supabase.storage.from(DRIVER_DOCUMENTS_BUCKET).remove([path]).catch(() => {});
    return storedValidation;
  }

  const result = await saveDriverDocumentMetadata({
    supabase,
    driverId,
    documentType: normalizedType,
    path,
    file: storedFile,
    required,
    expiresOn,
  });

  if (!result.ok) {
    await supabase.storage.from(DRIVER_DOCUMENTS_BUCKET).remove([path]).catch(() => {});
    console.error("[driver-doc-upload] metadata save failed", {
      driverId,
      documentType: normalizedType,
      message: result.error?.message,
      code: result.error?.code,
    });
    return { ok: false as const, error: "Could not save the document record. Please try again." };
  }

  return { ok: true as const, path, documentType: normalizedType };
}

export async function uploadDriverDocument({
  supabase,
  driverId,
  documentType,
  file,
  required = false,
  expiresOn,
}: {
  supabase: SupabaseClient;
  driverId: string;
  documentType: unknown;
  file: File;
  uploadedBy?: string | null;
  required?: boolean;
  source?: DriverDocumentSource;
  expiresOn?: string | null;
}) {
  if (!driverId) {
    return { ok: false as const, error: "Driver account is not linked yet." };
  }

  if (!file) {
    return { ok: false as const, error: "Choose a document to upload." };
  }

  const validated = validateDriverDocumentFile(file);
  if (!validated.ok) return validated;

  const normalizedType = normalizeDriverDocumentType(documentType);
  if (!(await verifyDriverExists(supabase, driverId))) {
    return { ok: false as const, error: "Driver account could not be verified." };
  }

  const path = createStoragePath(driverId, normalizedType, validated.extension);
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage.from(DRIVER_DOCUMENTS_BUCKET).upload(path, bytes, {
    contentType: validated.contentType,
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

  const result = await saveDriverDocumentMetadata({
    supabase,
    driverId,
    documentType: normalizedType,
    path,
    file,
    required,
    expiresOn,
  });

  if (!result.ok) {
    await supabase.storage.from(DRIVER_DOCUMENTS_BUCKET).remove([path]).catch(() => {});
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
