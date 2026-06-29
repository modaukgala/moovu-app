import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "za.co.moovu.customer",
  appName: "MOOVU",
  webDir: "capacitor-shell-customer",
  server: {
    url: process.env.CAPACITOR_CUSTOMER_URL || "https://moovurides.co.za",
    cleartext: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
