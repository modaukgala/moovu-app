import { Capacitor } from "@capacitor/core";

type HostedPaymentCheckoutOptions = {
  returnPath?: string;
};

function trustedReturnPath(value: string | undefined): string | null {
  if (!value) return null;

  const parsed = new URL(value, window.location.origin);
  if (parsed.origin !== window.location.origin) {
    throw new Error("Checkout return must stay within MOOVU.");
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export async function closeHostedPaymentCheckout(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("Browser")) return;

  try {
    const { Browser } = await import("@capacitor/browser");
    await Browser.close();
  } catch (error) {
    console.warn("[checkout-navigation] native Browser close unavailable", {
      platform: Capacitor.getPlatform(),
      reason: error instanceof Error ? error.message : "Unknown native Browser error",
    });
  }
}

export async function openHostedPaymentCheckout(
  url: string,
  options: HostedPaymentCheckoutOptions = {},
): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Secure checkout requires HTTPS.");
  const returnPath = trustedReturnPath(options.returnPath);

  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Browser")) {
    let finishedHandle: { remove: () => Promise<void> } | null = null;
    let appStateHandle: { remove: () => Promise<void> } | null = null;
    let returned = false;

    try {
      const { Browser } = await import("@capacitor/browser");
      if (returnPath) {
        const returnToStatus = () => {
          if (returned) return;
          returned = true;
          void Promise.all([
            finishedHandle?.remove(),
            appStateHandle?.remove(),
          ]);
          window.location.assign(returnPath);
        };
        const { App } = await import("@capacitor/app");
        finishedHandle = await Browser.addListener("browserFinished", returnToStatus);
        appStateHandle = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) returnToStatus();
        });
      }
      await Browser.open({ url: parsed.toString(), presentationStyle: "fullscreen", toolbarColor: "#0f172a" });
      return;
    } catch (error) {
      await Promise.all([
        finishedHandle?.remove().catch(() => undefined),
        appStateHandle?.remove().catch(() => undefined),
      ]);
      console.warn("[checkout-navigation] native Browser unavailable; using WebView navigation", {
        platform: Capacitor.getPlatform(),
        reason: error instanceof Error ? error.message : "Unknown native Browser error",
      });
    }
  }

  window.location.assign(parsed.toString());
}
