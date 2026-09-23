#!/usr/bin/env node
const args = new Set(process.argv.slice(2));
const profile = process.argv.find((value) => value.startsWith("--profile="))?.split("=")[1] ?? "baseline";
const url = process.env.RELEASE_PREFLIGHT_SUPABASE_URL ?? process.env.PHASE3_E2E_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.RELEASE_PREFLIGHT_SUPABASE_KEY ?? process.env.PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Read-only schema preflight credentials are unavailable.");
const projectRef = new URL(url).hostname.split(".")[0];
if (projectRef === "mvazbszenqahgqpznhhq" && !args.has("--allow-production-readonly")) {
  throw new Error("Production requires --allow-production-readonly. This command performs GET only.");
}
const requirements = {
  baseline: {
    tables: {
      trips: ["id","customer_id","driver_id","status","payment_method","fare_amount","financial_version","dispatch_state","dispatch_cycle","dispatch_sequence"],
      driver_trip_offers: ["id","trip_id","driver_id","status","dispatch_cycle","sequence_number","accept_deadline_at"],
      drivers: ["id","status","verification_status","profile_completed","online","busy"],
      driver_accounts: ["user_id","driver_id"],
      financial_transactions: ["id","idempotency_key","transaction_state","source_type","source_id"],
      financial_ledger_entries: ["transaction_id","entry_side","amount_cents"],
      phase2_finance_policy: ["policy_key","mode","go_basis_points","go_xl_basis_points","debt_limit_cents","subscription_required"],
    },
    rpcs: ["phase5_create_trip","reserve_trip_offer","accept_trip_offer","decline_trip_offer","phase05b_complete_trip","phase2_finance_eligibility"],
  },
  phase6: {
    tables: { phase6_policy: ["singleton","active"], phase6_applications: ["id","driver_id","status","cycle","revision"] },
    rpcs: ["phase6_new_work_eligible"],
  },
  payments: {
    tables: { online_payment_attempts: ["id","trip_id","state","verified_at","reconciliation_state"], online_provider_events: ["provider_event_id","trust_state","processing_state"] },
    rpcs: ["phase3_process_trusted_payment_event","phase3_process_trusted_driver_payment_event"],
  },
};
if (!requirements[profile]) throw new Error(`Unknown schema profile: ${profile}`);
const selected = profile === "baseline" ? [requirements.baseline] : [requirements.baseline, requirements[profile]];
const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" } });
if (!response.ok) throw new Error(`Schema catalogue request failed with HTTP ${response.status}.`);
const spec = await response.json();
const errors = [];
for (const contract of selected) {
  for (const [table, columns] of Object.entries(contract.tables)) {
    const schema = spec.definitions?.[table] ?? spec.components?.schemas?.[table];
    if (!schema) { errors.push(`missing table ${table}`); continue; }
    for (const column of columns) if (!schema.properties?.[column]) errors.push(`missing column ${table}.${column}`);
  }
  for (const rpc of contract.rpcs) if (!spec.paths?.[`/rpc/${rpc}`]) errors.push(`missing RPC ${rpc}`);
}
if (errors.length) {
  console.error(`RELEASE SCHEMA PREFLIGHT BLOCKED — ${profile} — ${projectRef}`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`RELEASE SCHEMA PREFLIGHT PASSED — ${profile} — ${projectRef}`);
}
