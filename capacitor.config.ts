import type { CapacitorConfig } from "@capacitor/cli";
import customerConfig from "./capacitor.customer.config";
import driverConfig from "./capacitor.driver.config";

function selectedConfig(): CapacitorConfig {
  const target = process.env.CAPACITOR_TARGET?.trim().toLowerCase();

  if (target === "customer") return customerConfig;
  if (target === "driver") return driverConfig;

  throw new Error(
    [
      "CAPACITOR_TARGET is required for MOOVU Capacitor operations.",
      "Use npm scripts such as npm run sync:customer, npm run sync:driver, npm run open:customer, or npm run open:driver.",
      "Do not run generic npx cap commands without choosing customer or driver.",
    ].join(" "),
  );
}

export default selectedConfig();
