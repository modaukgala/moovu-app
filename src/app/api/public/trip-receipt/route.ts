import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "Public receipt access has been disabled. Please log in to open your trip receipt.",
    },
    { status: 401 }
  );
}