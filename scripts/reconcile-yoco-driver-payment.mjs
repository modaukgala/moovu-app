import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const expectedProject = "mvazbszenqahgqpznhhq";
const checkoutId = process.argv[2]?.trim();

if (!/^ch_[A-Za-z0-9]+$/.test(checkoutId ?? "")) {
  throw new Error("Usage: node --env-file=.env.local scripts/reconcile-yoco-driver-payment.mjs ch_...");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const yocoSecretKey = process.env.YOCO_SECRET_KEY?.trim();
const yocoBaseUrl = (process.env.YOCO_API_BASE_URL ?? "https://payments.yoco.com/api").replace(/\/+$/, "");
const yocoMode = process.env.YOCO_ENVIRONMENT?.trim().toLowerCase();

if (!supabaseUrl || new URL(supabaseUrl).hostname.split(".")[0] !== expectedProject) {
  throw new Error(`Refusing to reconcile outside production project ${expectedProject}.`);
}
if (!serviceRoleKey || !yocoSecretKey || yocoMode !== "live") {
  throw new Error("Production Supabase and LIVE Yoco credentials are required.");
}

const response = await fetch(`${yocoBaseUrl}/checkouts/${encodeURIComponent(checkoutId)}`, {
  headers: { Authorization: `Bearer ${yocoSecretKey}` },
  cache: "no-store",
});
const rawBody = await response.text();
if (!response.ok) throw new Error(`Yoco checkout retrieval failed with HTTP ${response.status}.`);

const checkout = JSON.parse(rawBody);
if (
  checkout.id !== checkoutId ||
  checkout.status !== "completed" ||
  !Number.isSafeInteger(checkout.amount) ||
  checkout.amount <= 0 ||
  checkout.currency !== "ZAR" ||
  typeof checkout.paymentId !== "string" ||
  checkout.paymentId.length < 3 ||
  checkout.metadata?.paymentDomain !== "DRIVER_COMMISSION" ||
  typeof checkout.metadata?.paymentAttemptId !== "string"
) {
  throw new Error("Yoco did not return a completed Driver commission checkout with valid authority metadata.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: attempt, error: attemptError } = await supabase
  .from("driver_online_payment_attempts")
  .select("id,driver_id,provider_checkout_id,amount_cents,currency,state")
  .eq("id", checkout.metadata.paymentAttemptId)
  .eq("provider_checkout_id", checkoutId)
  .single();
if (attemptError || !attempt) throw new Error("Matching MOOVU Driver payment attempt was not found.");
if (
  attempt.driver_id !== checkout.metadata.driverId ||
  Number(attempt.amount_cents) !== checkout.amount ||
  attempt.currency !== checkout.currency
) {
  throw new Error("Yoco authority does not match the locked MOOVU payment obligation.");
}

const eventId = `checkout-retrieval:${checkout.paymentId}`;
const { data, error } = await supabase.rpc("phase3_process_trusted_driver_payment_event", {
  p_provider: "YOCO",
  p_event_id: eventId,
  p_event_type: "checkout.retrieved",
  p_raw_status: checkout.status,
  p_body_sha256: createHash("sha256").update(rawBody).digest("hex"),
  p_checkout_id: checkoutId,
  p_payment_id: checkout.paymentId,
  p_amount_cents: checkout.amount,
  p_currency: checkout.currency,
  p_outcome: "SUCCEEDED",
});
if (error) throw new Error(`Trusted settlement failed: ${error.message}`);

const { data: settledAttempt, error: settledAttemptError } = await supabase
  .from("driver_online_payment_attempts")
  .select("state,reconciliation_state,provider_payment_id,payment_ledger_transaction_id")
  .eq("id", attempt.id)
  .single();
if (settledAttemptError || !settledAttempt) {
  throw new Error("MOOVU could not verify the settled payment attempt.");
}
if (
  settledAttempt.state !== "SUCCEEDED" ||
  settledAttempt.reconciliation_state !== "MATCHED" ||
  settledAttempt.provider_payment_id !== checkout.paymentId ||
  typeof settledAttempt.payment_ledger_transaction_id !== "string"
) {
  throw new Error("MOOVU did not reach a verified, matched settlement state.");
}

console.log(JSON.stringify({
  ok: true,
  authority: "YOCO_AUTHENTICATED_CHECKOUT_RETRIEVAL",
  checkoutId,
  paymentId: checkout.paymentId,
  amountCents: checkout.amount,
  attemptId: attempt.id,
  result: data?.result ?? null,
  ledgerTransactionId: settledAttempt.payment_ledger_transaction_id,
}, null, 2));
