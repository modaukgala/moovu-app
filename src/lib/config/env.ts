type EnvKey =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"
  | "GOOGLE_MAPS_API_KEY"
  | "NEXT_PUBLIC_VAPID_PUBLIC_KEY"
  | "VAPID_PRIVATE_KEY"
  | "VAPID_SUBJECT"
  | "PUSH_INTERNAL_API_KEY"
  | "NEXT_PUBLIC_SITE_URL"
  | "NEXT_PUBLIC_FIREBASE_API_KEY"
  | "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"
  | "NEXT_PUBLIC_FIREBASE_PROJECT_ID"
  | "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"
  | "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"
  | "NEXT_PUBLIC_FIREBASE_APP_ID"
  | "NEXT_PUBLIC_FIREBASE_VAPID_KEY"
  | "FIREBASE_PROJECT_ID"
  | "FIREBASE_CLIENT_EMAIL"
  | "FIREBASE_PRIVATE_KEY";

export function getEnv(key: EnvKey) {
  const value = process.env[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

export function requireEnv(key: EnvKey) {
  const value = getEnv(key);

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

export function getSiteUrl() {
  return getEnv("NEXT_PUBLIC_SITE_URL") || "http://localhost:3000";
}

export const FIREBASE_CLIENT_ENV_KEYS: EnvKey[] = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
  "NEXT_PUBLIC_FIREBASE_VAPID_KEY",
];

export const FIREBASE_ADMIN_ENV_KEYS: EnvKey[] = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
];

export function missingEnv(keys: EnvKey[]) {
  return keys.filter((key) => !getEnv(key));
}

export function requireEnvGroup(label: string, keys: EnvKey[]) {
  const missing = missingEnv(keys);

  if (missing.length > 0) {
    throw new Error(`${label} is missing environment variables: ${missing.join(", ")}`);
  }
}
