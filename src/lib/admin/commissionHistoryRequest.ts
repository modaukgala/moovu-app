export function createCommissionHistoryRequest<Input, Output>(timeoutMs = 15000) {
  let active: AbortController | undefined;
  let failed: Input | undefined;

  function invalidate() {
    const previous = active;
    active = undefined;
    failed = undefined;
    previous?.abort();
  }

  async function run(input: Input, load: (input: Input, signal: AbortSignal) => Promise<Output>,
    publish: (state: { loading: boolean; error?: string; result?: Output }) => void) {
    invalidate();
    const controller = new AbortController();
    active = controller;
    publish({ loading: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("Commission history timed out. Try again.")), { once: true });
    });
    try {
      const result = await Promise.race([load(input, controller.signal), aborted]);
      if (active === controller) publish({ loading: false, result });
    } catch (error) {
      if (active === controller) {
        failed = input;
        publish({ loading: false, error: error instanceof Error ? error.message : "Commission history failed. Try again." });
      }
    } finally {
      clearTimeout(timer);
      if (active === controller) active = undefined;
    }
  }

  return { run, invalidate, failedRequest: () => failed };
}
