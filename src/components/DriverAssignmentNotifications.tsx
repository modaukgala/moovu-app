"use client";

import { useEffect, useRef } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import {
  ensureBrowserNotificationPermission,
  sendBrowserNotification,
} from "@/lib/browser-notify";

export default function DriverAssignmentNotifications({
  driverId,
}: {
  driverId: string | null | undefined;
}) {
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!driverId) return;

    let mounted = true;
    let channel: ReturnType<typeof supabaseClient.channel> | null = null;

    async function boot() {
      await ensureBrowserNotificationPermission();
      if (!mounted) return;

      channel = supabaseClient
        .channel(`driver-assignment-${driverId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "trips",
            filter: `driver_id=eq.${driverId}`,
          },
          (payload) => {
            const row: any = payload.new;
            if (!row?.id) return;

            const isAssigned = row.status === "assigned";
            const isOffered = row.status === "offered" || row.offer_status === "pending";

            if (!isAssigned && !isOffered) return;
            if (seenRef.current.has(row.id)) return;

            seenRef.current.add(row.id);

            sendBrowserNotification(
              "MOOVU Driver",
              isAssigned
                ? `A trip has been assigned to you: ${row.pickup_address ?? "Pickup"} → ${row.dropoff_address ?? "Dropoff"}`
                : `You have a trip offer: ${row.pickup_address ?? "Pickup"} → ${row.dropoff_address ?? "Dropoff"}`,
              `driver-trip-${row.id}`
            );
          }
        )
        .subscribe();
    }

    boot();

    return () => {
      mounted = false;
      if (channel) supabaseClient.removeChannel(channel);
    };
  }, [driverId]);

  return null;
}