export type VerifiedApplicant = { id: string; email?: string | null };

// The caller must obtain user from auth.getUser(token), never request JSON or metadata.
export function applicationIdentity(user: VerifiedApplicant | null, claimedUserId: unknown, claimedEmail: unknown) {
  if (!user?.id || !user.email) return { ok: false as const, status: 401, error: "Sign in to submit your driver application." };
  const email = user.email.trim().toLowerCase();
  if ((claimedUserId && String(claimedUserId) !== user.id)
    || (claimedEmail && String(claimedEmail).trim().toLowerCase() !== email)) {
    return { ok: false as const, status: 403, error: "Submit the application using your signed-in account." };
  }
  return { ok: true as const, userId: user.id, email };
}
