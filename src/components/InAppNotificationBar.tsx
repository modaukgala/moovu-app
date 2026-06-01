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

function vibrate() {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  navigator.vibrate([0, 160, 80, 220]);
}

function playAttentionSound() {
  try {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return;

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
  } catch {
    // Browsers may block audio until the user interacts with the app.
  }
}

function showSystemLikeAlert(detail: InAppNotificationDetail) {
  window.dispatchEvent(
    new CustomEvent<InAppNotificationDetail>(MOOVU_IN_APP_NOTIFICATION_EVENT, {
      detail,
    }),
  );
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export default function InAppNotificationBar() {
  const [notice, setNotice] = useState<InAppNotificationDetail | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    function show(detail: InAppNotificationDetail) {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
      }

      setNotice({
        tone: "info",
        loud: true,
        ...detail,
      });

      if (detail.loud !== false) {
        vibrate();
        playAttentionSound();
      }

      hideTimerRef.current = window.setTimeout(() => {
        setNotice(null);
      }, 5200);
    }

    function onEvent(event: Event) {
      const custom = event as CustomEvent<InAppNotificationDetail>;
      if (!custom.detail?.title) return;
      show(custom.detail);
    }

    function onWorkerMessage(event: MessageEvent) {
      const data = event.data as { type?: string; title?: string; body?: string; url?: string } | null;
      if (data?.type !== "MOOVU_PUSH") return;
      show({
        title: data.title || "MOOVU update",
        body: data.body,
        url: data.url,
        tone: "message",
      });
    }

    window.addEventListener(MOOVU_IN_APP_NOTIFICATION_EVENT, onEvent);
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
            message?: string;
            error?: string;
          } | null;

          if (!response.ok && json?.error) {
            show({
              title: "Action needs attention",
              body: json.error,
              tone: "danger",
              loud: false,
            });
          } else if (json?.message) {
            show({
              title: json.message,
              tone: json.ok === false ? "warning" : "success",
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
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
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

    const handles: NativeListenerHandle[] = [];

    PushNotifications.addListener("pushNotificationReceived", (notification) => {
      const data = notification.data as { url?: string; nativeActionType?: string } | undefined;
      showSystemLikeAlert({
        title: notification.title || "MOOVU update",
        body: notification.body || "You have a new MOOVU update.",
        url: data?.url,
        tone: data?.nativeActionType === "trip_offer" ? "offer" : "message",
      });
    })
      .then((handle) => handles.push(handle))
      .catch(() => undefined);

    return () => {
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
