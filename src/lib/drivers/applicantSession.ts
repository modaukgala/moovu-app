type ApplicantSession = { access_token: string; user: { id: string; email?: string | null } };
type AuthResult = { data: { session: ApplicantSession | null }; error: { message: string; code?: string } | null };
type ApplicantAuth = {
  getSession(): Promise<AuthResult>;
  signInWithPassword(input: { email: string; password: string }): Promise<AuthResult>;
  signUp(input: { email: string; password: string; options: { data: Record<string, string> } }): Promise<AuthResult>;
};

export async function getApplicantSession(auth: ApplicantAuth, input: {
  email: string; password: string; fullName: string; phone: string;
}) {
  const email = input.email.trim().toLowerCase();
  const current = await auth.getSession();
  if (current.error) throw new Error("Your session could not be restored. Please sign in again.");
  if (current.data.session) {
    if (current.data.session.user.email?.trim().toLowerCase() !== email) {
      throw new Error("You are signed in to a different account. Use that account's email or sign out first.");
    }
    return current.data.session;
  }
  const credentials = { email, password: input.password };
  const signedIn = await auth.signInWithPassword(credentials);
  if (signedIn.data.session && !signedIn.error) return signedIn.data.session;
  if (signedIn.error && signedIn.error.code !== "invalid_credentials") {
    throw new Error(signedIn.error.message);
  }
  const signup = await auth.signUp({ ...credentials, options: { data: {
    role: "driver", full_name: input.fullName, phone: input.phone,
  } } });
  if (signup.error) throw new Error(signup.error.message);
  if (!signup.data.session) {
    throw new Error("Confirm your email, then return to this form and submit again. Your entries remain here while this page stays open.");
  }
  return signup.data.session;
}
