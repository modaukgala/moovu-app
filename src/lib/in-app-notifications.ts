"use client";

export type InAppNotificationTone = "info" | "success" | "warning" | "danger" | "message" | "offer";

export type InAppNotificationDetail = {
  title: string;
  body?: string;
  tone?: InAppNotificationTone;
  url?: string;
  loud?: boolean;
};

export const MOOVU_IN_APP_NOTIFICATION_EVENT = "moovu:in-app-notification";

export function notifyInApp(detail: InAppNotificationDetail) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<InAppNotificationDetail>(MOOVU_IN_APP_NOTIFICATION_EVENT, {
      detail,
    }),
  );
}
