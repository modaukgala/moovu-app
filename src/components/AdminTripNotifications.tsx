"use client";

import { useEffect, useRef } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { notifyInApp } from "@/lib/in-app-notifications";
import { LIVE_LOCATION_CONFIG } from "@/lib/location/liveLocationConfig";
import { usePageVisibility } from "@/hooks/usePageVisibility";

type TripEventAlertRow = {
  id: string;
  trip_id: string | null;
  event_type: string | null;
  message: string | null;
  old_status: string | null;
  new_status: string | null;
  created_at: string | null;
};

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
  const tripEventsInitializedRef = useRef(false);
  const isPageVisible = usePageVisibility();

  useEffect(() => {
    function handleNewApplications(event: Event) {
      const detail = (event as CustomEvent<{ count?: number; total?: number }>).detail ?? {};
      const count = Number(detail.count ?? 0);
      const total = Number(detail.total ?? 0);
      notifyInApp({
        title: count === 1 ? "New driver application" : `${count || total || 1} new driver applications`,
        body: "Open Applications to verify and approve, suspend, or delete them.",
        url: "/admin/applications",
        tone: "offer",
        loud: true,
      });
    }

    window.addEventListener("moovu-admin:new-applications", handleNewApplications);
    return () => window.removeEventListener("moovu-admin:new-applications", handleNewApplications);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function pollTripEvents() {
      if (!isPageVisible) return;
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

    void pollTripEvents();
    timer = window.setInterval(() => {
      void pollTripEvents();
    }, LIVE_LOCATION_CONFIG.adminTripEventsRefreshMs);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [isPageVisible]);

  return null;
}
