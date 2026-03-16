function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported on this device/browser.");
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  return registration;
}

export async function askNotificationPermission() {
  if (!("Notification" in window)) {
    throw new Error("Notifications are not supported on this device/browser.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  return permission;
}

export async function subscribeToPush(registration: ServiceWorkerRegistration) {
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    throw new Error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY.");
  }

  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
}