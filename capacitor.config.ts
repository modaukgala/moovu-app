import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "za.co.moovurides.app",
  appName: "MOOVU",
  webDir: "capacitor-shell",
  server: {
    url: "https://moovurides.co.za",
    cleartext: false,
  },
};

export default config;
