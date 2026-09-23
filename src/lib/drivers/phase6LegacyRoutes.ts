import { NextResponse } from "next/server";

const retired = new Set(["/api/driver/apply", "/api/driver/profile/save", "/api/driver/documents/upload", "/api/driver/account/delete", "/api/admin/applications/action", "/api/admin/applications/create-driver", "/api/admin/driver-verification", "/api/admin/driver-corrections", "/api/admin/driver-document-review", "/api/admin/driver-docs/upload", "/api/admin/drivers/create"]);
export function phase6LegacyMutation(req: Request) {
  const path = new URL(req.url).pathname.replace(/\/$/, "");
  if (!retired.has(path) && path !== "/api/admin/drivers/remove") return null;
  return NextResponse.json({ error: "Use the versioned Driver onboarding and Admin review flow." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
