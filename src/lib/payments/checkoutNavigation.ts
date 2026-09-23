import { Capacitor } from "@capacitor/core";

export async function openHostedPaymentCheckout(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Secure checkout requires HTTPS.");

  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: parsed.toString(), presentationStyle: "fullscreen", toolbarColor: "#0f172a" });
    return;
  }

  window.location.assign(parsed.toString());
}
