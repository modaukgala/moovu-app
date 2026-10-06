export const PASSWORD_GUIDANCE = "Use at least 8 characters with an uppercase letter, a lowercase letter and a number.";

// Only for creating/changing a password. Existing sign-in credentials are grandfathered.
export function validNewPassword(password: string): boolean {
  return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password);
}
