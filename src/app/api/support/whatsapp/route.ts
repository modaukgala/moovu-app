import { NextResponse } from "next/server";

/**
 * WhatsApp support redirect. The support number lives only in the private
 * MOOVU_SUPPORT_WHATSAPP server setting (digits, international format), so it
 * never appears on app screens or in the public code.
 */
const TOPICS: Record<string, string> = {
  customer: "Hi MOOVU, I need help with a ride.",
  driver: "Hi MOOVU, I'm a driver and I need help.",
  lost: "Hi MOOVU, I left something in the car.",
  fare: "Hi MOOVU, my fare looks wrong.",
  card: "Hi MOOVU, I need help paying by card.",
  safety: "Hi MOOVU, I feel unsafe and need help.",
};

export async function GET(req: Request) {
  const number = (process.env.MOOVU_SUPPORT_WHATSAPP ?? "").replace(/\D/g, "");
  const url = new URL(req.url);
  if (!/^\d{10,15}$/.test(number)) {
    return NextResponse.redirect(new URL("/contact?support=unavailable", url.origin));
  }
  const topic = TOPICS[url.searchParams.get("topic") ?? ""] ?? TOPICS.customer;
  const trip = (url.searchParams.get("trip") ?? "").replace(/[^0-9a-f-]/gi, "").slice(0, 36);
  const text = trip ? `${topic} (Trip ${trip.slice(0, 8)})` : topic;
  return NextResponse.redirect(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, 302);
}
