"use client";

import { supabaseClient } from "@/lib/supabase/client";

const REFRESH_WINDOW_SECONDS = 60;

export async function getFreshAccessToken(forceRefresh = false) {
  if (forceRefresh) {
    const { data, error } = await supabaseClient.auth.refreshSession();
    if (error) return null;
    return data.session?.access_token ?? null;
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) return null;

  const session = data.session;
  if (!session?.access_token) {
    const refreshed = await supabaseClient.auth.refreshSession();
    return refreshed.error ? null : refreshed.data.session?.access_token ?? null;
  }

  const expiresAt = session.expires_at ?? 0;
  const shouldRefresh = expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000) + REFRESH_WINDOW_SECONDS;
  if (!shouldRefresh) return session.access_token;

  const refreshed = await supabaseClient.auth.refreshSession();
  return refreshed.error ? null : refreshed.data.session?.access_token ?? null;
}
