import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await req.json();
    const firstName = cleanText(body?.firstName);
    const lastName = cleanText(body?.lastName);
    const phone = cleanText(body?.phone);
    const email = cleanText(body?.email);

    if (!firstName || !lastName || !phone) {
      return NextResponse.json(
        { ok: false, error: "First name, last name, and phone are required." },
        { status: 400 }
      );
    }

    const { data, error } = await auth.supabaseAdmin
      .from("drivers")
      .insert({
        first_name: firstName,
        last_name: lastName,
        phone,
        email: email || null,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      console.error("[admin-driver-create] failed to create driver", error);
      return NextResponse.json(
        { ok: false, error: "Could not create driver. Please check the details and try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, driverId: data.id });
  } catch (error: unknown) {
    console.error("[admin-driver-create] unexpected error", errorMessage(error, "Unknown error"));
    return NextResponse.json(
      { ok: false, error: "Could not create driver. Please check the details and try again." },
      { status: 500 }
    );
  }
}
