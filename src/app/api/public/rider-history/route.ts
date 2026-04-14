import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "Public trip history has been disabled. Please log in to view your customer trip history.",
    },
    { status: 401 }
  );
}