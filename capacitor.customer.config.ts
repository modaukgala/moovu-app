import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "za.co.moovu.customer",
  appName: "MOOVU",
  webDir: "capacitor-shell-customer",
  server: {
    url: process.env.CAPACITOR_CUSTOMER_URL || "https://moovurides.co.za",
    cleartext: false,
  },
  // The customer app doesn't use background location, so leave that plugin out
  // (keeps Play's foreground-service declaration off the customer app).
  includePlugins: [
    "@capacitor/app",
    "@capacitor/browser",
    "@capacitor/camera",
    "@capacitor/geolocation",
    "@capacitor/push-notifications",
  ],
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
