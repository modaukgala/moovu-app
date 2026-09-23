import "server-only";

const YOCO_API_BASE_URL =
  process.env.YOCO_API_BASE_URL ?? "https://payments.yoco.com/api";

function getYocoSecretKey(): string {
  const secretKey = process.env.YOCO_SECRET_KEY?.trim();

  if (!secretKey) {
    throw new Error("YOCO_SECRET_KEY is not configured.");
  }

  return secretKey;
}

export type CreateYocoCheckoutInput = {
  amountCents: number;
  currency?: "ZAR";
  successUrl: string;
  cancelUrl: string;
  failureUrl?: string;
  metadata?: Record<string, string>;
};

export type YocoCheckout = {
  id: string;
  redirectUrl: string;
  status?: string;
};

type YocoCheckoutResponse = {
  id?: unknown;
  redirectUrl?: unknown;
  status?: unknown;
};

export async function createYocoCheckout(
  input: CreateYocoCheckoutInput,
): Promise<YocoCheckout> {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error(
      "Yoco checkout amount must be a positive integer in cents.",
    );
  }

  const response = await fetch(`${YOCO_API_BASE_URL}/checkouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getYocoSecretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amountCents,
      currency: input.currency ?? "ZAR",
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      ...(input.failureUrl ? { failureUrl: input.failureUrl } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }),
    cache: "no-store",
  });

  const data = (await response
    .json()
    .catch(() => null)) as YocoCheckoutResponse | null;

  if (!response.ok) {
    throw new Error(
      `Yoco checkout creation failed with HTTP ${response.status}.`,
    );
  }

  if (
    !data ||
    typeof data.id !== "string" ||
    typeof data.redirectUrl !== "string"
  ) {
    throw new Error("Yoco returned an invalid checkout response.");
  }

  return {
    id: data.id,
    redirectUrl: data.redirectUrl,
    status: typeof data.status === "string" ? data.status : undefined,
  };
}
