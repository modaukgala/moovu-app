import { NextResponse } from "next/server";

/**
 * Sends people to the right store page to update MOOVU.
 * Links live in Vercel settings so they can change without a new app release:
 * MOOVU_STORE_CUSTOMER_ANDROID, MOOVU_STORE_CUSTOMER_IOS,
 * MOOVU_STORE_DRIVER_ANDROID, MOOVU_STORE_DRIVER_IOS.
 */
const FALLBACK: Record<string, string> = {
  android: "https://play.google.com/store/search?q=MOOVU%20Rides&c=apps",
  ios: "https://apps.apple.com/za/search?term=MOOVU%20Rides",
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const app = url.searchParams.get("app") === "driver" ? "DRIVER" : "CUSTOMER";
  const platform = url.searchParams.get("platform") === "ios" ? "ios" : "android";
  const configured = process.env[`MOOVU_STORE_${app}_${platform.toUpperCase()}`]?.trim();
  const target = configured && /^https:\/\//.test(configured) ? configured : FALLBACK[platform];
  return NextResponse.redirect(target, 302);
}
