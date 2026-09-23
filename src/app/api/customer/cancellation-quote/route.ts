import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { phase4AuthorityForTrip } from "@/lib/finance/phase4AuthorityServer";
import { callPhase4Rpc } from "@/lib/server/phase4Rpc";

type Quote = {
  quote_id: string;
  expires_at: string;
  terms: { kind: string; fee_cents: number; driver_cents: number; moovu_cents: number; policy_version: string };
};

export async function POST(req: Request) {
  const auth = await getAuthenticatedCustomer(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const body = await req.json().catch(() => null);
  const tripId = String(body?.tripId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(tripId)) {
    return NextResponse.json({ ok: false, error: "Valid trip ID required." }, { status: 400 });
  }
  try {
    const authority = await phase4AuthorityForTrip(auth.supabaseAdmin, tripId);
    if (!authority) return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
    if (authority === "LEGACY") {
      // Never expose a trip to another Customer, even when it predates cutover.
      const { data } = await auth.supabaseAdmin.from("trips").select("customer_id")
        .eq("id", tripId).eq("customer_id", auth.customer.id).maybeSingle();
      if (!data) return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
      return NextResponse.json({ ok: true, authority });
    }
    const quote = await callPhase4Rpc<Quote>(auth.supabaseAdmin, "phase4b_quote_customer_cancellation", {
      p_trip_id: tripId, p_customer_id: auth.customer.id, p_actor_id: auth.user.id,
    }, (value) => typeof value.quote_id === "string" && typeof value.terms === "object");
    if (!quote.ok) return NextResponse.json({ ok: false, error: quote.error, code: quote.code }, { status: quote.status });
    return NextResponse.json({ ok: true, authority, quote: quote.result });
  } catch {
    return NextResponse.json({ ok: false, error: "Cancellation quote is unavailable." }, { status: 503 });
  }
}
