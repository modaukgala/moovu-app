import { NextResponse } from "next/server";
import { deleteCustomerAccount } from "@/lib/account-deletion/service";
import { getAuthenticatedCustomer } from "@/lib/customer/server";

export async function POST(req: Request) {
  // Apple Guideline 5.1.1(v) Account Deletion Compliance
  const auth = await getAuthenticatedCustomer(req);

  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const body = (await req.json().catch(() => null)) as {
    password?: unknown;
    confirmText?: unknown;
    reason?: unknown;
  } | null;

  const result = await deleteCustomerAccount({
    supabase: auth.supabaseAdmin,
    user: {
      id: auth.user.id,
      email: auth.user.email,
    },
    customer: {
      id: auth.customer.id,
    },
    password: typeof body?.password === "string" ? body.password : "",
    confirmText: typeof body?.confirmText === "string" ? body.confirmText : "",
    reason: typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) || null : null,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    message:
      "Your account has been successfully deleted. Any legally required records have been retained in accordance with applicable regulations.",
  });
}
