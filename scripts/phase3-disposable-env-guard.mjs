const expectedRef = "tangtlmdpnvmoviwrgvd";
const productionRef = "mvazbszenqahgqpznhhq";
const required = [
  "PHASE3_E2E_SUPABASE_URL",
  "PHASE3_E2E_SUPABASE_ANON_KEY",
  "PHASE3_E2E_SUPABASE_SERVICE_ROLE_KEY",
];

if (required.some((name) => !process.env[name]?.trim())) {
  console.error("Phase 3 disposable environment is incomplete.");
  process.exit(1);
}

let projectRef = "";
try {
  projectRef = new URL(process.env.PHASE3_E2E_SUPABASE_URL).hostname.split(".")[0];
} catch {
  console.error("Phase 3 disposable URL is invalid.");
  process.exit(1);
}

if (projectRef !== expectedRef || projectRef === productionRef) {
  console.error("Phase 3 disposable project guard rejected the configured project.");
  process.exit(1);
}

console.log("Phase 3 disposable environment guard passed.");
