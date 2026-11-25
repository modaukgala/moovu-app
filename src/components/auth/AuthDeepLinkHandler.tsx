"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { completeAuthFromUrl, NATIVE_AUTH_CALLBACK, takeRememberedNext } from "@/lib/auth/socialAuth";

/** Catches moovu://auth-callback in the native apps and finishes Google/Apple sign-in. */
export default function AuthDeepLinkHandler() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let remove: (() => void) | null = null;
    void App.addListener("appUrlOpen", async ({ url }) => {
      if (!url.startsWith(NATIVE_AUTH_CALLBACK)) return;
      await Browser.close().catch(() => undefined);
      try {
        await completeAuthFromUrl(url);
        window.location.assign(takeRememberedNext("/"));
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Sign-in failed. Please try again.");
      }
    }).then((h) => { remove = () => void h.remove(); });
    return () => { remove?.(); };
  }, []);
  return null;
}
