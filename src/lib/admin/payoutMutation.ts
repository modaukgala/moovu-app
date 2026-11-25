const specifications = {
  recordProviderFee: ["commission_first_record_provider_fee", "payment:uuid", "external:text", "evidence:text", "percentage:cents", "fixed:cents", "total:cents"],
  reviewProviderFee: ["commission_first_review_provider_fee", "evidence:uuid", "external:text", "percentage:cents", "fixed:cents", "total:cents"],
  allocate: ["commission_first_allocate", "trip:uuid", "operation:uuid"],
  recordManualPayment: ["commission_first_record_manual_payment", "allocation:uuid", "operation:uuid", "cents:cents", "paid_on:date", "bank_reference:text", "evidence_reference:text"],
  verifyManualPayment: ["commission_first_verify_manual_payment", "payment:uuid", "operation:uuid", "cents:cents", "paid_on:date", "bank_reference:text", "independent_evidence:text"],
} as const;

type Session = { ok: false; status: number } | {
  ok: true;
  actor: string;
  financial: boolean;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { code: string } | null;
  }>;
};

export async function handlePayoutMutation(req: Request, authenticate: (req: Request) => Promise<Session>) {
  if (req.method !== "POST") return Response.json({ ok: false }, { status: 405, headers: { Allow: "POST" } });
  try {
    const session = await authenticate(req);
    if (!session.ok) return Response.json({ ok: false, error: "Admin access required." }, { status: session.status });
    if (!session.financial) return Response.json({ ok: false, error: "Financial Admin access required." }, { status: 403 });
    const body = await req.json().catch(() => null);
    if (!body || typeof body.action !== "string" || !Object.hasOwn(specifications, body.action)) {
      return Response.json({ ok: false, error: "Invalid payout action." }, { status: 400 });
    }
    const [rpc, ...fields] = specifications[body.action as keyof typeof specifications];
    const args: Record<string, unknown> = { p_actor: session.actor };
    const allowed = new Set(["action"]);
    for (const field of fields) {
      const [key, type] = field.split(":");
      allowed.add(key);
      const value: unknown = body[key];
      const valid = type === "cents"
        ? typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        : typeof value === "string" && (type === "uuid"
          ? /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
          : type === "date" ? /^\d{4}-\d{2}-\d{2}$/.test(value) : value.trim().length > 0 && value.length <= 500);
      if (!valid) return Response.json({ ok: false, error: "Invalid payout operation fields." }, { status: 400 });
      args[`p_${key}`] = value;
    }
    if (Object.keys(body).some((key) => !allowed.has(key))) {
      return Response.json({ ok: false, error: "Unexpected payout operation fields." }, { status: 400 });
    }
    const { data, error } = await session.rpc(rpc, args);
    if (error) {
      const unavailable = ["PGRST202", "42883", "42P01"].includes(error.code);
      const rejected = ["P0001", "P0002", "22023", "22007", "22008", "23505", "23514", "42501"].includes(error.code);
      return Response.json({
        ok: false,
        error: unavailable ? "Authoritative payout capability is unavailable." : rejected
          ? "Payout operation requires financial review." : "Payout outcome unavailable. Retry using the original operation identity.",
      }, { status: unavailable ? 503 : rejected ? 409 : 500 });
    }
    if (data == null) return Response.json({ ok: false, error: "Authoritative payout outcome unavailable." }, { status: 503 });
    return Response.json({ ok: true, result: data });
  } catch {
    return Response.json({ ok: false, error: "Payout outcome unavailable. Retry using the original operation identity." }, { status: 500 });
  }
}
