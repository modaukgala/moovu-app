"use client";

import { useEffect, useRef } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import {
  ensureBrowserNotificationPermission,
  sendBrowserNotification,
} from "@/lib/browser-notify";

export default function AdminTripNotifications() {
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;

    async function boot() {
      await ensureBrowserNotificationPermission();
      if (!mounted) return;

      const channel = supabaseClient
        .channel("admin-new-trip-notifications")
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "trips",
          },
          (payload) => {
            const row: any = payload.new;

            if (!row?.id) return;
            if (row.status !== "requested") return;
            if (seenRef.current.has(row.id)) return;

            seenRef.current.add(row.id);

            sendBrowserNotification(
              "MOOVU Admin",
              `New trip requested: ${row.pickup_address ?? "Pickup"} → ${row.dropoff_address ?? "Dropoff"}`,
              `trip-${row.id}`
            );
          }
        )
        .subscribe();

      return () => {
        supabaseClient.removeChannel(channel);
      };
    }

    const cleanupPromise = boot();

    return () => {
      mounted = false;
      Promise.resolve(cleanupPromise).then((cleanup: any) => {
        if (typeof cleanup === "function") cleanup();
      });
    };
  }, []);

  return null;
}