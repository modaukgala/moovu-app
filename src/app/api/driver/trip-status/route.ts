import { NextResponse } from "next/server";

// Legacy endpoint intentionally fails closed. It bypassed Start OTP, arrival
// evidence and atomic completion. Active clients use the dedicated trip routes.
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "This legacy trip update endpoint is disabled. Refresh the Driver app and retry." },
    { status: 410 },
  );
}
