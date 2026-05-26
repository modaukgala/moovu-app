"use client";

import { useEffect } from "react";

const RELOAD_KEY = "moovu:client-recovery-reloaded";

function isRecoverableAssetError(value: unknown) {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : value && typeof value === "object" && "message" in value
          ? String((value as { message?: unknown }).message ?? "")
          : "";

  return /chunkloaderror|loading chunk|failed to fetch dynamically imported module|importing a module script failed/i.test(message);
}

function reloadOnce() {
  try {
    if (window.sessionStorage.getItem(RELOAD_KEY) === "1") return;
    window.sessionStorage.setItem(RELOAD_KEY, "1");
  } catch {
    // If storage is blocked, still try one recovery reload.
  }

  window.location.reload();
}

export default function ClientErrorRecovery() {
  useEffect(() => {
    function onError(event: ErrorEvent) {
      if (isRecoverableAssetError(event.error) || isRecoverableAssetError(event.message)) {
        reloadOnce();
      }
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      if (isRecoverableAssetError(event.reason)) {
        reloadOnce();
      }
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
