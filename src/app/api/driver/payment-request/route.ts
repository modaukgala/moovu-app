import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Manual bank-transfer payment submissions are no longer accepted. Use Pay Online.",
    },
    { status: 410 },
  );
}
