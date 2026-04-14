import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Public booking has been disabled. Please log in through the customer booking flow first.",
    },
    { status: 401 }
  );
}