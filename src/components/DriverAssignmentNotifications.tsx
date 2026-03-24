"use client";

import { useEffect } from "react";
import { supabaseClient } from "@/lib/supabase/client";

/**
 * DriverAssignmentNotifications
 *
 * This component no longer sends browser notifications.
 * Backend push notifications should notify the driver.
 * This realtime listener can still help the UI refresh itself later if needed.
 */
export default function DriverAssignmentNotifications({
  driverId,
}: {
  driverId: string | null | undefined;
}) {
  useEffect(() => {
    if (!driverId) return;

    const channel = supabaseClient
      .channel(`driver-trip-realtime-${driverId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trips",
          filter: `driver_id=eq.${driverId}`,
        },
        () => {
          // No browser Notification here.
          // Driver alerts must come from backend push.
        }
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, [driverId]);

  return null;
}