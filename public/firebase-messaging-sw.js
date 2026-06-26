/* global firebase */

const MOOVU_OFFLINE_CACHE = "moovu-fcm-offline-v1";
const MOOVU_OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(MOOVU_OFFLINE_CACHE)
      .then((cache) => cache.add(MOOVU_OFFLINE_URL))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestMode = event.request.mode;
  const accept = event.request.headers.get("accept") || "";
  const isNavigation = requestMode === "navigate" || accept.includes("text/html");

  if (!isNavigation) return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(MOOVU_OFFLINE_URL);
      return cached || new Response("MOOVU is offline. Please check your connection and try again.", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    })
  );
});

function notificationFromPayload(json) {
  const data = json && typeof json === "object" ? json.data || {} : {};
  const notification = json && typeof json === "object" ? json.notification || {} : {};
  const webpushNotification =
    json && typeof json === "object" ? json.webpush?.notification || {} : {};

  return {
    title:
      data.title ||
      notification.title ||
      webpushNotification.title ||
      json?.title ||
      "MOOVU",
    body:
      data.body ||
      notification.body ||
      webpushNotification.body ||
      json?.body ||
      "You have a new MOOVU update.",
    url:
      data.url ||
      notification.click_action ||
      json?.fcmOptions?.link ||
      json?.url ||
      "/",
    nativeActionType: data.nativeActionType || json?.nativeActionType || "",
  };
}

async function sendToVisibleClient(payload) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const visibleClient = clients.find((client) => client.focused || client.visibilityState === "visible");

  if (!visibleClient) return false;

  visibleClient.postMessage({
    type: "MOOVU_PUSH",
    title: payload.title,
    body: payload.body,
    url: payload.url || "/",
    nativeActionType: payload.nativeActionType || "",
  });
  return true;
}

async function showMoovuNotification(payload) {
  if (await sendToVisibleClient(payload)) return undefined;

  const isTripOffer = payload.nativeActionType === "trip_offer";
  return self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: {
      url: payload.url || "/",
      nativeActionType: payload.nativeActionType || "",
    },
    requireInteraction: isTripOffer,
    vibrate: isTripOffer
      ? [0, 450, 120, 450, 120, 450, 180, 650, 140, 650, 140, 650, 180, 900]
      : [0, 160, 80, 220],
  });
}

const firebaseReady = fetch("/api/push/fcm/config", { cache: "no-store" })
  .then((response) => response.json())
  .then((json) => {
    const config = json?.firebaseConfig;
    if (!config?.apiKey || !config?.projectId || !config?.messagingSenderId || !config?.appId) {
      return null;
    }

    importScripts("https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js");
    importScripts("https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging-compat.js");

    firebase.initializeApp(config);
    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      const notification = notificationFromPayload(payload);
      void showMoovuNotification(notification);
    });

    return messaging;
  })
  .catch((error) => {
    console.warn("[firebase-messaging-sw] Firebase messaging init skipped", error);
    return null;
  });

self.addEventListener("push", (event) => {
  event.waitUntil(
    firebaseReady.then((messaging) => {
      if (messaging) return undefined;

      let payload = {
        title: "MOOVU",
        body: "You have a new MOOVU update.",
        url: "/",
      };

      try {
        if (event.data) {
          payload = notificationFromPayload(event.data.json());
        }
      } catch {
        // Keep a safe default notification when a push payload is malformed.
      }

      return showMoovuNotification(payload);
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification?.data?.url || "/",
    self.location.origin
  );

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        const clientUrl = new URL(client.url);

        if (
          clientUrl.pathname === targetUrl.pathname &&
          clientUrl.search === targetUrl.search &&
          "focus" in client
        ) {
          return client.focus();
        }
      }

      for (const client of clients) {
        if ("navigate" in client && "focus" in client) {
          client.navigate(targetUrl.href);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl.href);
      }
    })
  );
});
