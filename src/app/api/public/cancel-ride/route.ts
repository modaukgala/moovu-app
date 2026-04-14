import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Public trip cancellation has been disabled. Please log in to manage your trip.",
    },
    { status: 401 }
  );
}