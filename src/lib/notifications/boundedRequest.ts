export async function boundedNotificationOperation<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Notification service timed out. Check your connection and try again.")), timeoutMs);
  });
  try {
    return await Promise.race([operation(), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function boundedNotificationRequest(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = 15000,
  request: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Notification service timed out. Check your connection and try again."));
    }, timeoutMs);
  });

  try {
    return await Promise.race([request(input, { ...init, signal: controller.signal }), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
