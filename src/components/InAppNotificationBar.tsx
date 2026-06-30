"use client";

import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { onMessage } from "firebase/messaging";
import {
  MOOVU_IN_APP_NOTIFICATION_EVENT,
  type InAppNotificationDetail,
} from "@/lib/in-app-notifications";
import { getFirebaseMessaging } from "@/lib/firebase/client";
import {
  bootstrapNativePushRegistration,
  syncNativePushToken,
  type NotificationRole,
} from "@/lib/notifications/registration";
import { supabaseClient } from "@/lib/supabase/client";

type NativeListenerHandle = {
  remove: () => Promise<void>;
};

function toneClass(tone: InAppNotificationDetail["tone"]) {
  switch (tone) {
    case "success":
      return "is-success";
    case "warning":
      return "is-warning";
    case "danger":
      return "is-danger";
    case "message":
      return "is-message";
    case "offer":
      return "is-offer";
    default:
      return "is-info";
  }
}

function normalizeNotice(value: InAppNotificationDetail | null | undefined) {
  if (!value || typeof value.title !== "string" || !value.title.trim()) return null;

  return {
    ...value,
    title: value.title.trim(),
    body: typeof value.body === "string" ? value.body : undefined,
    url: typeof value.url === "string" ? value.url : undefined,
  };
}

function vibrate(pattern: VibratePattern = [0, 160, 80, 220]) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  navigator.vibrate(pattern);
}

type StopSound = () => void;

function playAttentionSound(): StopSound {
  try {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return () => undefined;

    const context = new AudioContextConstructor();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.54, context.currentTime + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 1.15);
    gain.connect(context.destination);

    const schedule = [
      { start: 0, frequency: 659.25, duration: 0.34 },
      { start: 0, frequency: 880, duration: 0.34 },
      { start: 0.3, frequency: 783.99, duration: 0.36 },
      { start: 0.3, frequency: 1046.5, duration: 0.36 },
      { start: 0.62, frequency: 987.77, duration: 0.26 },
    ];

    for (const note of schedule) {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.frequency, context.currentTime + note.start);
      oscillator.connect(gain);
      oscillator.start(context.currentTime + note.start);
      oscillator.stop(context.currentTime + note.start + note.duration);
    }

    window.setTimeout(() => {
      void context.close().catch(() => undefined);
    }, 1500);
    return () => {
      void context.close().catch(() => undefined);
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(0);
      }
    };
  } catch {
    // Browsers may block audio until the user interacts with the app.
    return () => undefined;
  }
}

function playTripOfferBuzz(): StopSound {
  try {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return () => undefined;

    const context = new AudioContextConstructor();
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, context.currentTime);
    master.gain.exponentialRampToValueAtTime(0.86, context.currentTime + 0.05);
    master.gain.setValueAtTime(0.86, context.currentTime + 4.75);
    master.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 5);
    master.connect(context.destination);

    const pattern = [
      0, 450, 120, 450, 120, 450, 180, 650, 140, 650, 140, 650, 180, 900,
    ];
    vibrate(pattern);

    const oscillators: OscillatorNode[] = [];
    const scheduleBuzz = (frequency: number, type: OscillatorType, gainValue: number) => {
      const gain = context.createGain();
      gain.gain.setValueAtTime(gainValue, context.currentTime);
      gain.connect(master);

      for (let start = 0; start < 5; start += 0.62) {
        const oscillator = context.createOscillator();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, context.currentTime + start);
        oscillator.connect(gain);
        oscillator.start(context.currentTime + start);
        oscillator.stop(context.currentTime + Math.min(start + 0.42, 5));
        oscillators.push(oscillator);
      }
    };

    scheduleBuzz(185, "sawtooth", 0.18);
    scheduleBuzz(370, "triangle", 0.14);
    scheduleBuzz(988, "sine", 0.08);

    const stop = () => {
      for (const oscillator of oscillators) {
        try {
          oscillator.stop();
        } catch {}
      }
      void context.close().catch(() => undefined);
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(0);
      }
    };

    window.setTimeout(stop, 5100);
    return stop;
  } catch {
    return () => undefined;
  }
}

function showSystemLikeAlert(detail: InAppNotificationDetail) {
  window.dispatchEvent(
    new CustomEvent<InAppNotificationDetail>(MOOVU_IN_APP_NOTIFICATION_EVENT, {
      detail,
    }),
  );
}

function currentNotificationRole(): NotificationRole {
  const host = window.location.hostname.toLowerCase();
  const path = window.location.pathname.toLowerCase();
  if (host.startsWith("driver.") || path.startsWith("/driver")) return "driver";
  if (host.startsWith("admin.") || path.startsWith("/admin")) return "admin";
  return "customer";
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export default function InAppNotificationBar() {
  const [notice, setNotice] = useState<InAppNotificationDetail | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const stopSoundRef = useRef<StopSound | null>(null);

  useEffect(() => {
    function show(detail: InAppNotificationDetail) {
      const safeDetail = normalizeNotice(detail);
      if (!safeDetail) return;

      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
      }
      stopSoundRef.current?.();
      stopSoundRef.current = null;

      setNotice({
        tone: "info",
        loud: true,
        ...safeDetail,
      });

      if (safeDetail.loud !== false) {
        if (safeDetail.tone === "offer") {
          stopSoundRef.current = playTripOfferBuzz();
        } else {
          vibrate();
          stopSoundRef.current = playAttentionSound();
        }
      }

      hideTimerRef.current = window.setTimeout(() => {
        setNotice(null);
        stopSoundRef.current?.();
        stopSoundRef.current = null;
      }, 5200);
    }

    function onEvent(event: Event) {
      const custom = event as CustomEvent<InAppNotificationDetail>;
      show(custom.detail);
    }

    function onWorkerMessage(event: MessageEvent) {
      const data = event.data as {
        type?: string;
        title?: string;
        body?: string;
        url?: string;
        nativeActionType?: string;
      } | null;
      if (data?.type !== "MOOVU_PUSH") return;
      show({
        title: data.title || "MOOVU update",
        body: data.body,
        url: data.url,
        tone: data.nativeActionType === "trip_offer" ? "offer" : "message",
      });
    }

    function stopTripOfferAlert() {
      stopSoundRef.current?.();
      stopSoundRef.current = null;
    }

    window.addEventListener(MOOVU_IN_APP_NOTIFICATION_EVENT, onEvent);
    window.addEventListener("moovu:stop-trip-offer-alert", stopTripOfferAlert);
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);

      try {
        const method = (
          init?.method ||
          (input instanceof Request ? input.method : "GET")
        ).toUpperCase();
        const requestUrl = input instanceof Request ? input.url : String(input);
        const url = new URL(requestUrl, window.location.origin);

        if (method !== "GET" && url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
          const json = await response.clone().json().catch(() => null) as {
            ok?: boolean;
            message?: unknown;
            error?: unknown;
          } | null;

          const errorMessage = typeof json?.error === "string" ? json.error : "";
          const successMessage = typeof json?.message === "string" ? json.message : "";

          if (!response.ok && errorMessage) {
            show({
              title: "Action needs attention",
              body: errorMessage,
              tone: "danger",
              loud: false,
            });
          } else if (successMessage) {
            show({
              title: successMessage,
              tone: json?.ok === false ? "warning" : "success",
              loud: false,
            });
          }
        }
      } catch {
        // Do not let foreground notification UI affect app requests.
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
      window.removeEventListener(MOOVU_IN_APP_NOTIFICATION_EVENT, onEvent);
      window.removeEventListener("moovu:stop-trip-offer-alert", stopTripOfferAlert);
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      stopSoundRef.current?.();
    };
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let active = true;

    async function listenForWebFcm() {
      if (typeof window === "undefined" || Capacitor.isNativePlatform()) return;

      const messaging = await getFirebaseMessaging().catch(() => null);
      if (!active || !messaging) return;

      unsubscribe = onMessage(messaging, (payload) => {
        const data = payload.data ?? {};
        showSystemLikeAlert({
          title: data.title || payload.notification?.title || "MOOVU update",
          body: data.body || payload.notification?.body || "You have a new MOOVU update.",
          url: data.url,
          tone: data.nativeActionType === "trip_offer" ? "offer" : "message",
        });
      });
    }

    void listenForWebFcm();

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let active = true;
    const handles: NativeListenerHandle[] = [];

    async function setupNativePushListeners() {
      try {
        const receivedHandle = await PushNotifications.addListener("pushNotificationReceived", (notification) => {
          const data = notification.data as { url?: string; nativeActionType?: string } | undefined;
          showSystemLikeAlert({
            title: notification.title || "MOOVU update",
            body: notification.body || "You have a new MOOVU update.",
            url: data?.url,
            tone: data?.nativeActionType === "trip_offer" ? "offer" : "message",
          });
        });
        if (!active) {
          await receivedHandle.remove();
          return;
        }
        handles.push(receivedHandle);

        const registrationHandle = await PushNotifications.addListener("registration", (token) => {
          console.log("[push-registration] native registration listener received token", {
            platform: Capacitor.getPlatform(),
            length: String(token.value ?? "").trim().length,
          });
          void syncNativePushToken({
            token: token.value,
            role: currentNotificationRole(),
            supabase: supabaseClient,
          }).catch((error: unknown) => {
            console.error("[push-registration] refreshed native token save failed", {
              error: error instanceof Error ? error.message : "Unknown token sync error",
            });
          });
        });
        if (!active) {
          await registrationHandle.remove();
          return;
        }
        handles.push(registrationHandle);

        const errorHandle = await PushNotifications.addListener("registrationError", (error) => {
          console.error("[push-registration] native registration error", {
            error: error.error || "Unknown native registration error",
          });
        });
        if (!active) {
          await errorHandle.remove();
          return;
        }
        handles.push(errorHandle);

        await bootstrapNativePushRegistration({
          role: currentNotificationRole(),
          supabase: supabaseClient,
        });
      } catch (error: unknown) {
        console.error("[push-registration] native bootstrap failed", {
          error: error instanceof Error ? error.message : "Unknown bootstrap error",
        });
      }
    }

    void setupNativePushListeners();

    return () => {
      active = false;
      for (const handle of handles) {
        void handle.remove();
      }
    };
  }, []);

  if (!notice) return null;

  return (
    <div className={`moovu-in-app-notice ${toneClass(notice.tone)}`} role="status" aria-live="polite">
      <button
        type="button"
        className="moovu-in-app-notice-inner"
        onClick={() => {
          if (notice.url) window.location.assign(notice.url);
        }}
      >
        <span className="moovu-in-app-notice-pulse" />
        <span className="min-w-0">
          <span className="moovu-in-app-notice-title">{notice.title}</span>
          {notice.body ? <span className="moovu-in-app-notice-body">{notice.body}</span> : null}
        </span>
      </button>
    </div>
  );
}
