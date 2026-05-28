import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.moovu.driver",
  appName: "MOOVU Driver",
  webDir: "capacitor-shell-driver",
  server: {
    url: process.env.CAPACITOR_DRIVER_URL || "https://driver.moovurides.co.za/driver",
    cleartext: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
