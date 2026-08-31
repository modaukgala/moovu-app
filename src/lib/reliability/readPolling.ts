export type ReadPolicy = {
  normalMs: number;
  disconnectedMs: number;
  failureMs: readonly number[];
  maxMs: number;
};

export const READ_POLICIES = {
  driverOffers: { normalMs: 10_000, disconnectedMs: 15_000, failureMs: [15_000, 20_000], maxMs: 20_000 },
  driverTrip: { normalMs: 10_000, disconnectedMs: 15_000, failureMs: [15_000, 20_000, 30_000], maxMs: 30_000 },
  customerTrip: { normalMs: 15_000, disconnectedMs: 20_000, failureMs: [30_000, 45_000, 60_000], maxMs: 60_000 },
  location: { normalMs: 30_000, disconnectedMs: 45_000, failureMs: [45_000, 60_000], maxMs: 60_000 },
  chat: { normalMs: 30_000, disconnectedMs: 45_000, failureMs: [45_000, 60_000], maxMs: 60_000 },
  unread: { normalMs: 45_000, disconnectedMs: 60_000, failureMs: [60_000], maxMs: 60_000 },
  adminBoard: { normalMs: 15_000, disconnectedMs: 20_000, failureMs: [30_000, 45_000, 60_000], maxMs: 60_000 },
  adminMap: { normalMs: 30_000, disconnectedMs: 45_000, failureMs: [45_000, 60_000], maxMs: 60_000 },
} as const satisfies Record<string, ReadPolicy>;

export function pollDelay(policy: ReadPolicy, failures: number, connected: boolean, random = Math.random) {
  const base = failures > 0
    ? policy.failureMs[Math.min(failures - 1, policy.failureMs.length - 1)]
    : connected ? policy.normalMs : policy.disconnectedMs;
  return Math.min(policy.maxMs, Math.max(policy.normalMs, Math.round(base * (0.9 + 0.2 * random()))));
}

type ReadTask = (signal: AbortSignal) => Promise<boolean | void>;

export class ReadRequestError extends Error {
  category: "authentication" | "server" | "application";
  constructor(category: "authentication" | "server" | "application") { super(category); this.category = category; }
}

export function readFailure(status: number): never {
  throw new ReadRequestError(status === 401 || status === 403 ? "authentication" : status >= 500 ? "server" : "application");
}

/** One controller per logical read, shared by timer, Realtime and manual refresh. */
export function createReadController(policy: ReadPolicy, name: string, options: {
  now?: () => number;
  random?: () => number;
  visible?: () => boolean;
  timeoutMs?: number;
  log?: (fields: Record<string, string | number | boolean>) => void;
} = {}) {
  const now = options.now ?? Date.now;
  const visible = options.visible ?? (() => typeof document === "undefined" || !document.hidden);
  const log = options.log ?? ((fields) => console.info("[read-reliability]", fields));
  let failures = 0;
  let connected = true;
  let retryAt = 0;
  let active: Promise<boolean> | null = null;
  let abort: AbortController | null = null;
  let terminal = false;
  const delay = () => failures > 0 && retryAt > now()
    ? retryAt - now()
    : pollDelay(policy, failures, connected, options.random);
  return {
    delay,
    setConnected(value: boolean) { connected = value; },
    setTerminal(value: boolean) { terminal = value; },
    isTerminal: () => terminal,
    abort() { abort?.abort(); },
    failures: () => failures,
    run(task: ReadTask): Promise<boolean> {
      if (active) return active;
      if (terminal || !visible() || now() < retryAt) return Promise.resolve(false);
      const controller = new AbortController();
      abort = controller;
      const started = now();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 12_000);
      active = Promise.resolve().then(async () => {
        let success = false;
        let errorCategory = "application";
        try {
          success = (await task(controller.signal)) !== false && !controller.signal.aborted;
        } catch (error) {
          errorCategory = error instanceof ReadRequestError ? error.category : "transport";
          // No URLs, tokens, response bodies or participant data in reliability logs.
        } finally {
          clearTimeout(timer);
        }
        if (controller.signal.aborted && !timedOut) return false;
        const previousFailures = failures;
        failures = success ? 0 : failures + 1;
        retryAt = success ? 0 : now() + pollDelay(policy, failures, connected, options.random);
        if (!success || previousFailures > 0) log({
          poller: name, success, failures, durationMs: now() - started,
          timeout: timedOut, nextDelayMs: success ? delay() : retryAt - now(),
          realtimeConnected: connected, recovered: success && previousFailures > 0,
          errorCategory: success ? "none" : timedOut ? "timeout" : errorCategory,
        });
        return success;
      }).finally(() => { active = null; abort = null; });
      return active;
    },
  };
}

export type ReadController = ReturnType<typeof createReadController>;

/** Never schedules another timer until the previous read has settled. */
export function startReadLoop(controller: ReadController, task: () => Promise<unknown>, immediate = true) {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hidden = () => typeof document !== "undefined" && document.hidden;
  const schedule = (delay: number) => {
    if (!stopped && !hidden() && !controller.isTerminal()) timer = setTimeout(tick, delay);
  };
  async function tick() {
    timer = undefined;
    if (stopped || hidden() || controller.isTerminal()) return;
    running = true;
    try { await task(); } catch { /* Read controller records transport failures. */ }
    finally { running = false; schedule(controller.delay()); }
  }
  const visibility = () => {
    clearTimeout(timer);
    if (!running) schedule(controller.delay());
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", visibility);
  schedule(immediate ? 0 : controller.delay());
  return () => {
    stopped = true;
    clearTimeout(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visibility);
  };
}
