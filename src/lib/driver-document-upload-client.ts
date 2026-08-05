"use client";

import { getFreshAccessToken } from "@/lib/auth/client-access-token";
import {
  validateDriverDocumentFile,
  type DriverDocumentType,
} from "@/lib/driver-documents";
import { DRIVER_DOCUMENTS_BUCKET } from "@/lib/driver-document-storage";
import { supabaseClient } from "@/lib/supabase/client";

type UploadApiResponse = {
  ok?: boolean;
  error?: string;
  path?: string;
  uploadToken?: string;
  documentType?: DriverDocumentType;
};

type UploadDriverDocumentFromClientOptions = {
  endpoint: "/api/driver/documents/upload" | "/api/admin/driver-docs/upload";
  file: File;
  documentType: DriverDocumentType;
  driverId?: string;
  required?: boolean;
  expiresOn?: string;
  sessionExpiredMessage: string;
};

async function readResponse(response: Response) {
  return (await response.json().catch(() => null)) as UploadApiResponse | null;
}

async function authenticatedRequest(
  endpoint: UploadDriverDocumentFromClientOptions["endpoint"],
  body: Record<string, unknown>,
  sessionExpiredMessage: string
) {
  let token = await getFreshAccessToken();
  if (!token) return { ok: false as const, status: 401, error: sessionExpiredMessage };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const json = await readResponse(response);

    if (response.status !== 401 || attempt === 1) {
      return {
        ok: response.ok && json?.ok === true,
        status: response.status,
        data: json,
        error: json?.error || (response.status === 401 ? sessionExpiredMessage : "The upload request failed."),
      };
    }

    token = await getFreshAccessToken(true);
    if (!token) return { ok: false as const, status: 401, error: sessionExpiredMessage };
  }

  return { ok: false as const, status: 500, error: "The upload request failed." };
}

export async function uploadDriverDocumentFromClient({
  endpoint,
  file,
  documentType,
  driverId,
  required = false,
  expiresOn = "",
  sessionExpiredMessage,
}: UploadDriverDocumentFromClientOptions) {
  const validation = validateDriverDocumentFile(file);
  if (!validation.ok) return validation;

  const sharedPayload = {
    driverId,
    documentType,
    required,
    expiresOn,
    file: {
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
    },
  };

  try {
    const prepared = await authenticatedRequest(
      endpoint,
      { action: "prepare", ...sharedPayload },
      sessionExpiredMessage
    );
    const preparedData = "data" in prepared ? prepared.data : null;

    if (!prepared.ok || !preparedData?.path || !preparedData.uploadToken) {
      return { ok: false as const, error: prepared.error };
    }

    const { error: storageError } = await supabaseClient.storage
      .from(DRIVER_DOCUMENTS_BUCKET)
      .uploadToSignedUrl(preparedData.path, preparedData.uploadToken, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (storageError) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[driver-doc-upload-client] storage upload failed", {
          documentType,
          message: storageError.message,
        });
      }
      return { ok: false as const, error: "Storage upload failed. Please retry." };
    }

    const finalized = await authenticatedRequest(
      endpoint,
      { action: "finalize", ...sharedPayload, path: preparedData.path },
      sessionExpiredMessage
    );
    const finalizedData = "data" in finalized ? finalized.data : null;

    if (!finalized.ok || !finalizedData?.path) {
      return { ok: false as const, error: finalized.error || "Could not save the document record." };
    }

    return {
      ok: true as const,
      path: finalizedData.path,
      documentType: finalizedData.documentType ?? documentType,
    };
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[driver-doc-upload-client] unexpected failure", {
        documentType,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
    return { ok: false as const, error: "Your document could not be uploaded. Please retry." };
  }
}
