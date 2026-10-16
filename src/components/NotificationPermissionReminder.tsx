"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { BellRing, X } from "lucide-react";
import { registerForPushNotifications, type NotificationRole } from "@/lib/notifications/registration";
import { classifyNotificationPermission, shouldShowNotificationReminder, type ReminderPermission } from "@/lib/notifications/permissionReminder";
import { supabaseClient } from "@/lib/supabase/client";

type Props = { role: Extract<NotificationRole, "customer" | "driver">; active: boolean };

const copy = {
  customer: {
    title: "Stay updated on your ride",
    body: "Enable notifications to know when your Driver arrives, sends a message, accepts your booking, and more.",
    action: "Allow notifications",
  },
  driver: {
    title: "Never miss a trip request",
    body: "Enable notifications to receive new ride offers, Customer messages, trip updates and important MOOVU alerts.",
    action: "Enable notifications",
  },
} as const;

async function readPermission(): Promise<ReminderPermission> {
  if (Capacitor.isNativePlatform()) {
    try {
      const result = await PushNotifications.checkPermissions();
      return classifyNotificationPermission(result.receive, true);
    } catch {
      return "unsupported";
    }
  }
  if (typeof window === "undefined" || !window.isSecureContext || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return "unsupported";
  }
  return classifyNotificationPermission(Notification.permission, true);
}

export default function NotificationPermissionReminder({ role, active }: Props) {
  const [permission, setPermission] = useState<ReminderPermission>("unsupported");
  const [dismissed, setDismissed] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [registrationFailed, setRegistrationFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const checking = useRef(false);
  const previousActive = useRef(active);
  const closeButton = useRef<HTMLButtonElement>(null);
  const visible = ready && sessionId && active && !dismissed && (registrationFailed || shouldShowNotificationReminder(permission, active, dismissed));

  const check = useCallback(async (newForeground: boolean) => {
    if (checking.current) return;
    checking.current = true;
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session?.user?.id) {
        setSessionId(null);
        setDismissed(true);
        return;
      }
      const claimedRole = String(session.user.app_metadata?.role || session.user.user_metadata?.role || "").toLowerCase();
      if ((claimedRole === "driver" || claimedRole === "admin" || claimedRole === "customer") && claimedRole !== role) {
        setSessionId(null);
        setDismissed(true);
        return;
      }
      setSessionId(session.user.id);
      setPermission(await readPermission());
      if (newForeground) setDismissed(false);
      setReady(true);
    } finally {
      checking.current = false;
    }
  }, [role]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void check(false), 1800);
    return () => window.clearTimeout(timer);
  }, [active, check, role]);

  useEffect(() => {
    if (!active) return;
    let removeNative: (() => void) | undefined;
    let disposed = false;
    let hidden = document.visibilityState === "hidden";
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hidden = true;
      else if (hidden) { hidden = false; void check(true); }
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (Capacitor.isNativePlatform()) {
      void App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) hidden = true;
        else if (hidden) { hidden = false; void check(true); }
      }).then((handle) => { if (disposed) void handle.remove(); else removeNative = () => void handle.remove(); }).catch(() => {});
    }
    return () => { disposed = true; document.removeEventListener("visibilitychange", onVisibility); removeNative?.(); };
  }, [active, check]);

  useEffect(() => {
    if (previousActive.current && !active) setDismissed(true);
    previousActive.current = active;
  }, [active]);

  useEffect(() => {
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        setSessionId(null);
        setDismissed(true);
      } else if (session.user.id !== sessionId) {
        setSessionId(session.user.id);
        setDismissed(false);
        setReady(false);
        window.setTimeout(() => void check(false), 0);
      }
    });
    return () => subscription.unsubscribe();
  }, [check, sessionId]);

  useEffect(() => {
    if (!visible) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
      if (event.key !== "Tab") return;
      const controls = Array.from(document.querySelectorAll<HTMLButtonElement>(".moovu-permission-reminder button:not(:disabled)"));
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previousFocus?.focus(); };
  }, [visible]);

  async function enable() {
    if (permission === "denied" || permission === "limited") {
      if (Capacitor.getPlatform() === "ios") window.location.href = "app-settings:";
      else setMessage("Open your device or browser settings, allow MOOVU notifications, then return to the app.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session?.user?.id || session.user.id !== sessionId) {
        setMessage("Please sign in again before enabling notifications.");
        return;
      }
      const result = await registerForPushNotifications({ userId: session.user.id, role, supabase: supabaseClient });
      if (result.ok) {
        setRegistrationFailed(false);
        setPermission("granted");
        setDismissed(true);
      } else {
        setRegistrationFailed(true);
        setMessage(result.message);
        setPermission(await readPermission());
      }
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;
  const settings = permission === "denied" || permission === "limited";
  const content = copy[role];
  return (
    <div className="moovu-permission-reminder-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setDismissed(true); }}>
      <section className={`moovu-permission-reminder ${role === "driver" ? "is-driver" : ""}`} role="dialog" aria-modal="true" aria-labelledby="moovu-permission-title" aria-describedby="moovu-permission-description">
        <button ref={closeButton} type="button" className="moovu-permission-reminder-close" aria-label="Dismiss notification reminder" onClick={() => setDismissed(true)}><X size={20} aria-hidden="true" /></button>
        <div className="moovu-permission-reminder-art" aria-hidden="true"><BellRing size={role === "driver" ? 40 : 52} strokeWidth={1.7} /><span className="moovu-permission-reminder-dot" /></div>
        <span className="moovu-permission-reminder-brand">MOOVU {role === "driver" ? "DRIVER" : "RIDES"}</span>
        <h2 id="moovu-permission-title">{content.title}</h2>
        <p id="moovu-permission-description">{permission === "limited" ? "MOOVU notifications are currently delivered quietly or with limited alerts. You can choose full alerts in your device settings." : permission === "denied" ? "Notifications are blocked. Allow MOOVU alerts in your device or browser settings." : content.body}</p>
        {message ? <p className="moovu-permission-reminder-message" role="status">{message}</p> : null}
        <button type="button" className="moovu-permission-reminder-primary" disabled={busy} onClick={() => void enable()}>{busy ? "Enabling…" : settings ? Capacitor.getPlatform() === "ios" ? "Open settings" : "How to enable in settings" : content.action}</button>
        <button type="button" className="moovu-permission-reminder-later" onClick={() => setDismissed(true)}>Not now</button>
      </section>
    </div>
  );
}
