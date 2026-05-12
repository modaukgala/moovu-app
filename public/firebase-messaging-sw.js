/* global firebase */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
  };
}

function showMoovuNotification(payload) {
  return self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: payload.url || "/" },
    requireInteraction: false,
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
