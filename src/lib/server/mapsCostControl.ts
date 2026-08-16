import { createHash } from "node:crypto";
import {
  MAP_OPERATION_POLICY,
  isMapCircuitLimitReached,
  type MapOperation,
} from "@/lib/maps/mapRequestPolicy";
import { resolveCachedJson } from "@/lib/server/requestControl";

type OperationStats = {
  cacheHits: number;
  cacheMisses: number;
  providerSuccesses: number;
  providerFailures: number;
  sharedBlocks: number;
  circuitBlocks: number;
};

type MapsCostStore = {
  providerCalls: Record<MapOperation, number[]>;
  stats: Record<MapOperation, OperationStats>;
  sharedGuardDisabledUntil: number;
  sharedGuardWarningLogged: boolean;
};

declare global {
  var __moovuMapsCostStore: MapsCostStore | undefined;
}

const OPERATIONS: MapOperation[] = [
  "route",
  "geocode",
  "reverse_geocode",
  "autocomplete",
  "place_details",
];

export class MapCostProtectionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly reason: string,
  ) {
    super(message);
    this.name = "MapCostProtectionError";
  }
}

function blankStats(): OperationStats {
  return {
    cacheHits: 0,
    cacheMisses: 0,
    providerSuccesses: 0,
    providerFailures: 0,
    sharedBlocks: 0,
    circuitBlocks: 0,
  };
}

function store(): MapsCostStore {
  if (!globalThis.__moovuMapsCostStore) {
    const providerCalls = {} as Record<MapOperation, number[]>;
    const stats = {} as Record<MapOperation, OperationStats>;
    for (const operation of OPERATIONS) {
      providerCalls[operation] = [];
      stats[operation] = blankStats();
    }
    globalThis.__moovuMapsCostStore = {
      providerCalls,
      stats,
      sharedGuardDisabledUntil: 0,
      sharedGuardWarningLogged: false,
    };
  }
  return globalThis.__moovuMapsCostStore;
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function pruneProviderCalls(operation: MapOperation) {
  const cutoff = Date.now() - 60_000;
  const current = store().providerCalls[operation].filter((timestamp) => timestamp > cutoff);
  store().providerCalls[operation] = current;
  return current;
}

function checkLocalCircuit(operation: MapOperation) {
  const calls = pruneProviderCalls(operation);
  const limit = MAP_OPERATION_POLICY[operation].globalCircuitPerMinute;
  if (isMapCircuitLimitReached(operation, calls.length)) {
    store().stats[operation].circuitBlocks += 1;
    console.error("[maps-cost-control] circuit_open", { operation, calls: calls.length, limit });
    throw new MapCostProtectionError(
      "Map service is temporarily busy. Please try again shortly.",
      503,
      "local_circuit_open",
    );
  }
  calls.push(Date.now());
}

type SharedGuardResult = {
  enabled: boolean;
  allowed: boolean;
  reason?: string;
  requestId?: string;
};

async function checkSharedGuard(params: {
  operation: MapOperation;
  requestHash: string;
  actorHash: string;
}): Promise<SharedGuardResult> {
  const state = store();
  if (state.sharedGuardDisabledUntil > Date.now()) {
    return { enabled: false, allowed: true };
  }

  try {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    const policy = MAP_OPERATION_POLICY[params.operation];
    const { data, error } = await supabaseAdmin.rpc("guard_google_maps_request", {
      p_operation: params.operation,
      p_request_hash: params.requestHash,
      p_actor_hash: params.actorHash,
      p_actor_limit: policy.clientLimitPerMinute,
      p_global_limit: policy.globalCircuitPerMinute,
      p_lease_seconds: 8,
    });

    if (error) throw error;
    const result = (data ?? {}) as { allowed?: boolean; reason?: string; request_id?: string };
    return {
      enabled: true,
      allowed: result.allowed !== false,
      reason: result.reason,
      requestId: result.request_id,
    };
  } catch (error: unknown) {
    state.sharedGuardDisabledUntil = Date.now() + 5 * 60_000;
    if (!state.sharedGuardWarningLogged) {
      state.sharedGuardWarningLogged = true;
      console.warn("[maps-cost-control] shared guard unavailable; using process-local protection", {
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
    return { enabled: false, allowed: true };
  }
}

async function finishSharedGuard(params: {
  requestId?: string;
  outcome: "success" | "failure";
  errorCode?: string;
}) {
  if (!params.requestId || store().sharedGuardDisabledUntil > Date.now()) return;
  try {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    await supabaseAdmin.rpc("finish_google_maps_request", {
      p_request_id: params.requestId,
      p_outcome: params.outcome,
      p_error_code: params.errorCode ?? null,
    });
  } catch {
    // Provider delivery must not fail because operational telemetry is unavailable.
  }
}

export function getGoogleMapsServerKey() {
  return (
    process.env.GOOGLE_MAPS_SERVER_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    ""
  );
}

export function mapsRequestActor(req: Request, scope: string) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || req.headers.get("x-real-ip")?.trim()
    || req.headers.get("cf-connecting-ip")?.trim()
    || "unknown";
  const agent = req.headers.get("user-agent")?.slice(0, 100) || "unknown";
  return hash(`${scope}|${ip}|${agent}`);
}

export async function runControlledMapsRequest<T>(params: {
  operation: MapOperation;
  requestKey: string;
  actorKey?: string;
  ttlMs?: number;
  loader: () => Promise<T>;
}) {
  const cacheKey = `maps:${params.operation}:${hash(params.requestKey)}`;
  const actorHash = hash(params.actorKey || "server-internal");
  const requestHash = hash(`${params.operation}|${params.requestKey}`);
  const ttlMs = params.ttlMs ?? MAP_OPERATION_POLICY[params.operation].ttlMs;
  let sharedRequestId: string | undefined;

  const result = await resolveCachedJson(cacheKey, ttlMs, async () => {
    const guard = await checkSharedGuard({
      operation: params.operation,
      requestHash,
      actorHash,
    });
    sharedRequestId = guard.requestId;
    if (!guard.allowed) {
      store().stats[params.operation].sharedBlocks += 1;
      const reason = guard.reason || "shared_limit";
      console.warn("[maps-cost-control] shared_request_blocked", { operation: params.operation, reason });
      throw new MapCostProtectionError(
        reason === "duplicate_in_flight"
          ? "This map request is already being processed. Please try again shortly."
          : "Map service is temporarily busy. Please try again shortly.",
        reason === "actor_rate_limit" ? 429 : 503,
        reason,
      );
    }

    checkLocalCircuit(params.operation);
    store().stats[params.operation].cacheMisses += 1;
    try {
      const value = await params.loader();
      store().stats[params.operation].providerSuccesses += 1;
      await finishSharedGuard({ requestId: sharedRequestId, outcome: "success" });
      return value;
    } catch (error: unknown) {
      store().stats[params.operation].providerFailures += 1;
      await finishSharedGuard({
        requestId: sharedRequestId,
        outcome: "failure",
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
      throw error;
    }
  });

  if (result.cacheStatus === "hit") store().stats[params.operation].cacheHits += 1;
  console.info("[maps-cost-control] request", {
    operation: params.operation,
    cache: result.cacheStatus,
  });
  return result;
}

export function getLocalMapsCostSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    operations: Object.fromEntries(
      OPERATIONS.map((operation) => [
        operation,
        {
          ...store().stats[operation],
          providerCallsLastMinute: pruneProviderCalls(operation).length,
          circuitLimitPerMinute: MAP_OPERATION_POLICY[operation].globalCircuitPerMinute,
        },
      ]),
    ),
  };
}

export function mapErrorResponse(error: unknown) {
  if (error instanceof MapCostProtectionError) {
    return { status: error.status, message: error.message, reason: error.reason };
  }
  return {
    status: 500,
    message: error instanceof Error ? error.message : "Map service error.",
    reason: "provider_error",
  };
}
