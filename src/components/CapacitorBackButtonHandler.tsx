"use client";

import { useEffect } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { usePathname, useRouter } from "next/navigation";

const ROUTE_STACK_KEY = "moovu:native-route-stack";
const MAX_STACK_ITEMS = 30;

function getCurrentRoute() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function readRouteStack() {
  try {
    const stored = window.sessionStorage.getItem(ROUTE_STACK_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : [];

    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function writeRouteStack(stack: string[]) {
  window.sessionStorage.setItem(
    ROUTE_STACK_KEY,
    JSON.stringify(stack.slice(-MAX_STACK_ITEMS)),
  );
}

export default function CapacitorBackButtonHandler() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const currentRoute = getCurrentRoute();
    const stack = readRouteStack();
    const previousRoute = stack.at(-2);
    const latestRoute = stack.at(-1);

    if (latestRoute === currentRoute) {
      return;
    }

    if (previousRoute === currentRoute) {
      writeRouteStack(stack.slice(0, -1));
      return;
    }

    writeRouteStack([...stack, currentRoute]);
  }, [pathname]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let removeListener: (() => void) | undefined;

    void CapacitorApp.addListener("backButton", () => {
      const stack = readRouteStack();

      if (stack.length > 1) {
        writeRouteStack(stack.slice(0, -1));
        window.history.back();
        return;
      }

      if (window.location.pathname !== "/") {
        writeRouteStack(["/"]);
        router.replace("/");
      }
    }).then((listener) => {
      removeListener = () => {
        void listener.remove();
      };
    });

    return () => {
      removeListener?.();
    };
  }, [router]);

  return null;
}
