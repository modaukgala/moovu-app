import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "Public trip status access has been disabled. Please log in to view your trip.",
    },
    { status: 401 }
  );
}