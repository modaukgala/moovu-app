import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { supabaseClient } from "@/lib/supabase/client";

export type SocialProvider = "google" | "apple";

/** Deep link registered in the MOOVU apps (iOS URL type + Android intent filter). */
export const NATIVE_AUTH_CALLBACK = "moovu://auth-callback";
const NEXT_KEY = "moovu:auth-next";

function callbackUrl() {
  return Capacitor.isNativePlatform() ? NATIVE_AUTH_CALLBACK : `${window.location.origin}/auth/callback`;
}

function rememberNext(next: string) {
  try { window.localStorage.setItem(NEXT_KEY, next.startsWith("/") ? next : "/"); } catch {}
}

export function takeRememberedNext(fallback: string) {
  try {
    const v = window.localStorage.getItem(NEXT_KEY);
    window.localStorage.removeItem(NEXT_KEY);
    return v && v.startsWith("/") && !v.startsWith("//") ? v : fallback;
  } catch { return fallback; }
}

/**
 * Google/Apple sign-in needs the in-app Browser plugin on phones. Older app
 * versions don't have it, so there we hide the buttons and the link prompt
 * instead of showing an error. New app versions include it automatically.
 */
export function socialSignInAvailable() {
  if (typeof window === "undefined") return false;
  if (!Capacitor.isNativePlatform()) return true;
  return Capacitor.isPluginAvailable("Browser");
}

async function openAuthUrl(url: string) {
  // Google blocks sign-in inside embedded app web views, so native apps use the
  // phone's browser and come back through the moovu:// deep link.
  if (Capacitor.isNativePlatform()) await Browser.open({ url, presentationStyle: "popover" });
  else window.location.assign(url);
}

/** Sign in or sign up with Google/Apple. */
export async function signInWithProvider(provider: SocialProvider, next: string) {
  rememberNext(next);
  const { data, error } = await supabaseClient.auth.signInWithOAuth({
    provider,
    options: { redirectTo: callbackUrl(), skipBrowserRedirect: true },
  });
  if (error || !data?.url) throw new Error(error?.message ?? "Sign-in is unavailable right now.");
  await openAuthUrl(data.url);
}

/** Add Google/Apple to the account that is signed in now (same account, nothing deleted). */
export async function linkProvider(provider: SocialProvider, next: string) {
  rememberNext(next);
  const { data, error } = await supabaseClient.auth.linkIdentity({
    provider,
    options: { redirectTo: callbackUrl(), skipBrowserRedirect: true },
  });
  if (error || !data?.url) throw new Error(error?.message ?? "Linking is unavailable right now.");
  await openAuthUrl(data.url);
}

/** Finish sign-in from a callback URL (PKCE code or implicit tokens). */
export async function completeAuthFromUrl(rawUrl: string) {
  const url = new URL(rawUrl.replace(/^moovu:\/\//, "https://app.local/"));
  const errorText = url.searchParams.get("error_description") ?? new URLSearchParams(url.hash.slice(1)).get("error_description");
  if (errorText) throw new Error(errorText);
  const code = url.searchParams.get("code");
  if (code) {
    const { error } = await supabaseClient.auth.exchangeCodeForSession(code);
    if (error) throw new Error(error.message);
    return;
  }
  const hash = new URLSearchParams(url.hash.slice(1));
  const access_token = hash.get("access_token");
  const refresh_token = hash.get("refresh_token");
  if (access_token && refresh_token) {
    const { error } = await supabaseClient.auth.setSession({ access_token, refresh_token });
    if (error) throw new Error(error.message);
    return;
  }
  throw new Error("Sign-in was not completed. Please try again.");
}

/** True when the signed-in user only has email/password (no Google or Apple yet). */
export async function needsSocialLink() {
  if (!socialSignInAvailable()) return false;
  const { data } = await supabaseClient.auth.getUser();
  const identities = data.user?.identities ?? [];
  return Boolean(data.user) && !identities.some((i) => i.provider === "google" || i.provider === "apple");
}
