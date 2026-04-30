self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {
    title: "MOOVU Notification",
    body: "You have a new update.",
    url: "/",
  };

  try {
    if (event.data) {
      const json = event.data.json();
      data = {
        title: json.title || data.title,
        body: json.body || data.body,
        url: json.url || data.url,
      };
    }
  } catch {
    // Ignore malformed push payloads
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url },
      requireInteraction: false,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification?.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        const clientUrl = new URL(client.url);

        if (clientUrl.pathname === targetUrl && "focus" in client) {
          return client.focus();
        }
      }

      for (const client of clients) {
        if ("navigate" in client && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
