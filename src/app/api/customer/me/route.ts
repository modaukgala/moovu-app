import { NextResponse } from "next/server";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { getLegalAcceptanceStatus } from "@/lib/legal";

export async function GET(req: Request) {
  const auth = await getAuthenticatedCustomer(req);

  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  return NextResponse.json({
    ok: true,
    customer: {
      id: auth.customer.id,
      first_name: auth.customer.first_name,
      last_name: auth.customer.last_name,
      phone: auth.customer.phone,
      status: auth.customer.status,
    },
    legalAcceptance: getLegalAcceptanceStatus(
      auth.user.user_metadata ?? {},
      auth.customer as Record<string, unknown>,
    ),
  });
}
