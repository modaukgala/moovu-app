import type { SupabaseClient } from "@supabase/supabase-js";

export const DRIVER_DOCUMENTS_BUCKET = "driver-docs";

function trimStoragePath(value: string) {
  return value
    .trim()
    .replace(/^\/+/, "")
    .replace(/^object\/(?:public|sign|authenticated)\//, "")
    .replace(new RegExp(`^${DRIVER_DOCUMENTS_BUCKET}/`), "");
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeDriverDocumentStoragePath(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const pathParts = safeDecode(url.pathname).split(`/${DRIVER_DOCUMENTS_BUCKET}/`);
    const path = pathParts.length > 1 ? pathParts[pathParts.length - 1] : "";
    return path ? trimStoragePath(path) : null;
  } catch {
    return trimStoragePath(safeDecode(raw.split("?")[0] || ""));
  }
}

export function driverDocumentPathsMatch(left: unknown, right: unknown) {
  const normalizedLeft = normalizeDriverDocumentStoragePath(left);
  const normalizedRight = normalizeDriverDocumentStoragePath(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export async function createDriverDocumentSignedUrl(
  supabaseAdmin: SupabaseClient,
  storedPath: unknown,
  expiresInSeconds = 60 * 5
) {
  const path = normalizeDriverDocumentStoragePath(storedPath);
  if (!path) {
    return { ok: false as const, error: "Document file path is invalid." };
  }

  const { data, error } = await supabaseAdmin.storage
    .from(DRIVER_DOCUMENTS_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    return { ok: false as const, error: error?.message || "Could not open this document." };
  }

  return { ok: true as const, url: data.signedUrl, path };
}
