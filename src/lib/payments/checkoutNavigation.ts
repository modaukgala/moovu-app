import { Capacitor } from "@capacitor/core";

export async function openHostedPaymentCheckout(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Secure checkout requires HTTPS.");

  if (Capacitor.isNativePlatform()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: parsed.toString(), presentationStyle: "fullscreen", toolbarColor: "#0f172a" });
      return;
    } catch (error) {
      console.warn("[checkout-navigation] native Browser unavailable; using WebView navigation", {
        platform: Capacitor.getPlatform(),
        reason: error instanceof Error ? error.message : "Unknown native Browser error",
      });
    }
  }

  window.location.assign(parsed.toString());
}
