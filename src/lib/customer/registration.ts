type LookupUser = { id: string; email?: string; user_metadata?: Record<string, unknown> };
type ListUsers = (options: { page: number; perPage: number }) => Promise<{
  data: { users: LookupUser[] }; error: unknown;
}>;

export async function findRegistrationIdentity(listUsers: ListUsers, email: string) {
  // Admin APIs are paginated. Never interpret an incomplete scan as absence.
  const normalized = email.trim().toLowerCase();
  let legacyAlias: LookupUser | null = null;
  let ambiguousAlias = false;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await listUsers({ page, perPage: 1000 });
    if (error) return { user: null, error };
    const user = data.users.find(user => user.email?.toLowerCase() === normalized);
    if (user) return { user, error: null };
    for (const candidate of data.users) {
      if (String(candidate.user_metadata?.customer_email ?? "").toLowerCase() !== normalized) continue;
      if (legacyAlias && legacyAlias.id !== candidate.id) ambiguousAlias = true;
      legacyAlias = candidate;
    }
    if (data.users.length < 1000) return ambiguousAlias
      ? { user: null, error: { code: "identity_alias_ambiguous" } }
      : { user: legacyAlias, error: null };
  }
  return { user: null, error: { code: "identity_lookup_limit" } };
}

export function normalizeRegistrationPhone(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!/^\+?[\d\s()-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (/^27[1-9]\d{8}$/.test(digits)) return `0${digits.slice(2)}`;
  return /^0[1-9]\d{8}$/.test(digits) ? digits : null;
}

export function registrationFailure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
  if (["email_exists", "user_already_exists", "23505"].includes(code)) {
    return { status: 409, code: "ACCOUNT_EXISTS", error: "An account already exists for these details. Sign in with your email or reset your password to continue." };
  }
  if (code === "email_not_confirmed") {
    return { status: 403, code: "VERIFICATION_REQUIRED", error: "Verify your email address before signing in." };
  }
  if (["weak_password", "email_address_invalid"].includes(code)) {
    return { status: 400, code: "INVALID_DETAILS", error: "Check your email address and password, then try again." };
  }
  return { status: 503, code: "REGISTRATION_UNAVAILABLE", error: "Registration could not be completed. If you already created an account, sign in with your email to finish setup. Otherwise try again shortly." };
}

export function isMissingCustomerEmail(error: { code?: string; message?: string } | null) {
  return Boolean(error && ["PGRST204", "42703"].includes(error.code ?? "") &&
    /(?:column[^\n]*email|email[^\n]*column)/i.test(error.message ?? ""));
}
