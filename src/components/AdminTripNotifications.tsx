"use client";

import { useEffect, useRef } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { notifyInApp } from "@/lib/in-app-notifications";

type ApplicationAlertRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: string | null;
};

type TripEventAlertRow = {
  id: string;
  trip_id: string | null;
  event_type: string | null;
  message: string | null;
  old_status: string | null;
  new_status: string | null;
  created_at: string | null;
};

const SEEN_APPLICATIONS_KEY = "moovu-admin-seen-driver-applications";
const SEEN_TRIP_EVENTS_KEY = "moovu-admin-seen-trip-events";
const TRIP_EVENT_LABELS: Record<string, { title: string; tone: "info" | "success" | "warning" | "danger" | "message" | "offer" }> = {
  trip_created: { title: "New trip request", tone: "offer" },
  scheduled_trip_created: { title: "New scheduled trip", tone: "offer" },
  offer_accepted: { title: "Driver accepted trip", tone: "success" },
  driver_arrived: { title: "Driver arrived", tone: "success" },
  trip_started: { title: "Trip started", tone: "message" },
  trip_completed: { title: "Trip completed", tone: "success" },
  trip_completed_admin: { title: "Trip completed by admin", tone: "success" },
  trip_cancelled: { title: "Trip cancelled", tone: "warning" },
  customer_no_show: { title: "Customer no-show", tone: "warning" },
};

function driverName(row: ApplicationAlertRow) {
  return `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() || "New driver";
}

function readSeenApplicationIds() {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(SEEN_APPLICATIONS_KEY) || "[]") as string[]);
  } catch {
    return new Set<string>();
  }
}

function writeSeenApplicationIds(ids: Set<string>) {
  try {
    window.localStorage.setItem(SEEN_APPLICATIONS_KEY, JSON.stringify(Array.from(ids).slice(-150)));
  } catch {
    // Local storage can be unavailable in strict browser modes.
  }
}

function readSeenTripEventIds() {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(SEEN_TRIP_EVENTS_KEY) || "[]") as string[]);
  } catch {
    return new Set<string>();
  }
}

function writeSeenTripEventIds(ids: Set<string>) {
  try {
    window.localStorage.setItem(SEEN_TRIP_EVENTS_KEY, JSON.stringify(Array.from(ids).slice(-250)));
  } catch {
    // Local storage can be unavailable in strict browser modes.
  }
}

function tripEventTitle(eventType: string | null) {
  return TRIP_EVENT_LABELS[String(eventType ?? "")]?.title ?? "Trip update";
}

function tripEventTone(eventType: string | null) {
  return TRIP_EVENT_LABELS[String(eventType ?? "")]?.tone ?? "message";
}

function tripEventBody(row: TripEventAlertRow) {
  const tripSuffix = row.trip_id ? ` Trip ${row.trip_id.slice(0, 8)}.` : "";
  const message = String(row.message ?? "").trim();
  const normalized = message
    ? message.replace(/[.]+$/, "")
    : `A trip status changed to ${row.new_status ?? "updated"}`;
  return `${normalized}.${tripSuffix}`;
}

/**
 * AdminTripNotifications
 *
 * Backend push remains the source of truth for background notifications.
 * This component adds foreground admin alerts for urgent operational queues,
 * using protected API reads so browser-side RLS cannot break admin pages.
 */
export default function AdminTripNotifications() {
  const applicationsInitializedRef = useRef(false);
  const tripEventsInitializedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function pollApplications() {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (!session || cancelled) return;

      const res = await fetch("/api/admin/driver-applications?status=pending_review", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const json = await res.json().catch(() => null) as {
        ok?: boolean;
        applications?: ApplicationAlertRow[];
      } | null;

      if (!json?.ok || cancelled) return;

      const rows = (json.applications ?? [])
        .filter((row) => row.id)
        .sort((a, b) => {
          const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
          return aTime - bTime;
        });

      const seenIds = readSeenApplicationIds();

      if (!applicationsInitializedRef.current) {
        for (const row of rows) seenIds.add(row.id);
        writeSeenApplicationIds(seenIds);
        applicationsInitializedRef.current = true;
        return;
      }

      const freshRows = rows.filter((row) => !seenIds.has(row.id));
      if (freshRows.length === 0) return;

      for (const row of freshRows) seenIds.add(row.id);
      writeSeenApplicationIds(seenIds);

      const newest = freshRows[freshRows.length - 1];
      notifyInApp({
        title: freshRows.length === 1 ? "New driver application" : `${freshRows.length} new driver applications`,
        body:
          freshRows.length === 1
            ? `${driverName(newest)} submitted an application${newest.phone ? ` (${newest.phone})` : ""}.`
            : "Open Applications to verify and approve, suspend, or delete them.",
        url: "/admin/applications",
        tone: "offer",
        loud: true,
      });
    }

    async function pollTripEvents() {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (!session || cancelled) return;

      const res = await fetch("/api/admin/trips/events?recent=1&limit=30", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const json = await res.json().catch(() => null) as {
        ok?: boolean;
        events?: TripEventAlertRow[];
      } | null;

      if (!json?.ok || cancelled) return;

      const rows = (json.events ?? [])
        .filter((row) => row.id)
        .sort((a, b) => {
          const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
          return aTime - bTime;
        });

      const seenIds = readSeenTripEventIds();

      if (!tripEventsInitializedRef.current) {
        for (const row of rows) seenIds.add(row.id);
        writeSeenTripEventIds(seenIds);
        tripEventsInitializedRef.current = true;
        return;
      }

      const freshRows = rows.filter((row) => !seenIds.has(row.id));
      if (freshRows.length === 0) return;

      for (const row of freshRows) seenIds.add(row.id);
      writeSeenTripEventIds(seenIds);

      for (const row of freshRows.slice(-4)) {
        notifyInApp({
          title: tripEventTitle(row.event_type),
          body: tripEventBody(row),
          url: row.trip_id ? `/admin/trips/${row.trip_id}` : "/admin/trips",
          tone: tripEventTone(row.event_type),
          loud: true,
        });
      }
    }

    void pollApplications();
    void pollTripEvents();
    timer = window.setInterval(() => {
      void pollApplications();
      void pollTripEvents();
    }, 10000);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  return null;
}
