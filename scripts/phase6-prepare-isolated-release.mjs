import fs from "node:fs/promises";
import path from "node:path";
const baseline = path.resolve("..", ".codex-phase6-release-baseline");
const release = path.resolve("..", ".codex-phase6-release");
await fs.cp(baseline, release, { recursive: true });
const files = [
  "src/app/driver/onboarding/page.tsx", "src/app/admin/(protected)/onboarding/page.tsx",
  "src/app/api/driver/onboarding/route.ts", "src/app/api/driver/onboarding/evidence/route.ts", "src/app/api/driver/onboarding/retention/route.ts",
  "src/app/api/admin/onboarding/route.ts", "src/app/api/admin/onboarding/retention/route.ts",
  "src/components/driver/Phase6Auth.tsx", "src/components/driver/Phase6DeletionRequest.tsx",
  "src/lib/drivers/phase6Policy.ts", "src/lib/drivers/phase6Policy.test.ts", "src/lib/drivers/phase6Image.ts", "src/lib/drivers/phase6Image.test.ts", "src/lib/drivers/phase6Server.ts", "src/lib/drivers/phase6NewWork.ts", "src/lib/drivers/phase6LegacyRoutes.ts", "src/lib/drivers/phase6Capture.ts",
  "src/app/api/driver/status/route.ts", "src/lib/dispatch/respondToOffer.ts",
  "src/app/api/admin/drivers/status/route.ts", "src/app/admin/(protected)/layout.tsx", "src/app/driver/page.tsx", "src/app/driver/account/delete/page.tsx",
  "src/app/api/admin/driver-documents/route.ts", "src/app/api/admin/driver-docs/signed-url/route.ts",
  "src/app/driver/apply/page.tsx", "src/app/driver/complete-profile/page.tsx", "middleware.ts",
];
// Every full overlay is separately compared against the deployed baseline.
for (const file of files) { const target = path.join(release, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(file, target); }
const retired = ["driver/apply", "driver/profile/save", "driver/documents/upload", "driver/account/delete", "admin/applications/action", "admin/applications/create-driver", "admin/driver-verification", "admin/driver-corrections", "admin/driver-document-review", "admin/driver-docs/upload", "admin/drivers/create", "admin/drivers/remove"];
for (const endpoint of retired) {
  const file = `src/app/api/${endpoint}/route.ts`;
  let text = await fs.readFile(path.join(baseline, file), "utf8");
  text = 'import { phase6LegacyMutation } from "@/lib/drivers/phase6LegacyRoutes";\n' + text;
  if (!text.includes("export async function POST(req: Request) {")) throw new Error("Retirement patch requires reviewed handler shape.");
  text = text.replace("export async function POST(req: Request) {", "export async function POST(req: Request) {\n  const retirement = phase6LegacyMutation(req);\n  if (retirement) return retirement;");
  await fs.writeFile(path.join(release, file), text); files.push(file);
}
// Add ONLY Phase 6 eligibility to deployed dispatch; exclude unrelated attempt-history changes.
const dispatchFile = "src/lib/dispatch/dispatchCandidates.ts";
let dispatch = await fs.readFile(path.join(baseline, dispatchFile), "utf8");
dispatch = 'import { phase6NewWork } from "@/lib/drivers/phase6NewWork";\n' + dispatch;
dispatch = dispatch.replace('  const financeByDriver =', '  const onboardingResults = await Promise.all(prelim.map(driver => phase6NewWork(supabase, driver.id)));\n  if (onboardingResults.some(result => !result.ok)) throw new Error("Onboarding eligibility unavailable.");\n  const onboardingEligible = new Set(prelim.filter((_, index) => onboardingResults[index].eligible).map(driver => driver.id));\n  const financeByDriver =');
dispatch = dispatch.replace('  return prelim\n', '  return prelim\n    .filter(driver => onboardingEligible.has(driver.id))\n');
dispatch = dispatch.replace('  if (!finance.ok) return { ok: false as const, error: finance.error };', '  if (!finance.ok) return { ok: false as const, error: finance.error };\n  const onboarding = await phase6NewWork(supabase, driverId);\n  if (!onboarding.ok || !onboarding.eligible) return { ok: false as const, error: onboarding.error ?? "Onboarding required." };');
await fs.writeFile(path.join(release, dispatchFile), dispatch); files.push(dispatchFile);
const pkg = JSON.parse(await fs.readFile(path.join(baseline, "package.json"), "utf8")); pkg.dependencies.sharp = "0.34.5";
await fs.writeFile(path.join(release, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
await fs.mkdir(path.join(release, ".vercel"), { recursive: true }); await fs.copyFile(".vercel/project.json", path.join(release, ".vercel/project.json"));
await fs.writeFile(path.join(release, ".vercelignore"), "node_modules\n.next\n.env*\nsupabase\ndocs\nphase6-release-manifest.json\n");
await fs.writeFile(path.join(release, "phase6-release-manifest.json"), JSON.stringify({ baselineDeployment: "dpl_DXSpah8kBx3VSjep1o9mMneq1ZC1", runtimeFiles: files, packageChange: "sharp 0.34.5 only", environmentFiles: 0 }, null, 2));
console.log(`PHASE 6 ISOLATED RELEASE PREPARED — ${files.length} scoped runtime files; deployed booking/dispatch baseline preserved.`);
