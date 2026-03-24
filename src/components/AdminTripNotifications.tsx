"use client";

import { useEffect } from "react";
import { supabaseClient } from "@/lib/supabase/client";

/**
 * AdminTripNotifications
 *
 * This component no longer tries to send browser notifications.
 * It only keeps a lightweight realtime subscription so the admin UI
 * can react to fresh data if needed in future.
 *
 * Core trip notifications must come from the backend via /api/push/send.
 */
export default function AdminTripNotifications() {
  useEffect(() => {
    const channel = supabaseClient
      .channel("admin-trip-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trips",
        },
        () => {
          // Intentionally no browser Notification here.
          // Backend push is the source of truth for real notifications.
        }
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, []);

  return null;
}