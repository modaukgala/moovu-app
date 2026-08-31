"use client";

import { useEffect, useMemo } from "react";
import { createReadController, startReadLoop, type ReadController, type ReadPolicy } from "@/lib/reliability/readPolling";

export function useReliableRead(policy: ReadPolicy, name: string, connected = true, scope = "") {
  const controller = useMemo(() => {
    // Scope is a lifecycle key only. Never include trip/share tokens in logs.
    void scope;
    return createReadController(policy, name);
  }, [policy, name, scope]);
  useEffect(() => { controller.setConnected(connected); }, [controller, connected]);
  useEffect(() => () => controller.abort(), [controller]);
  return controller;
}

export function useReadLoop(controller: ReadController, task: () => Promise<unknown>, enabled = true, immediate = true) {
  useEffect(() => {
    if (!enabled) return;
    return startReadLoop(controller, task, immediate);
  }, [controller, enabled, immediate, task]);
}
