importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification?.data?.url || "/";
  const targetUrl = new URL(url, self.location.origin);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.pathname === targetUrl.pathname && "focus" in client) {
          return client.focus();
        }
      }

      return self.clients.openWindow ? self.clients.openWindow(targetUrl.href) : undefined;
    })
  );
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "MOOVU",
    body: "You have a new MOOVU update.",
    url: "/",
  };

  try {
    if (event.data) {
      const json = event.data.json();
      payload = {
        title: json.notification?.title || json.title || payload.title,
        body: json.notification?.body || json.body || payload.body,
        url: json.data?.url || json.url || payload.url,
      };
    }
  } catch {}

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: payload.url },
    })
  );
});
