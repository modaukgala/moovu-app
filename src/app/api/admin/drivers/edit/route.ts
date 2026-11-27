import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";

const FIELDS = {
  firstName: "first_name", lastName: "last_name", vehicleMake: "vehicle_make", vehicleModel: "vehicle_model",
  vehicleColor: "vehicle_color", vehicleRegistration: "vehicle_registration", vehicleYear: "vehicle_year", seatingCapacity: "seating_capacity",
} as const;

/** Admin edits a driver's names and car details (audited). ID and licence details go back to the driver instead. */
export async function POST(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!isFinancialAdminRole(auth.profile.role)) return NextResponse.json({ ok: false, error: "Only the owner or an admin can edit drivers." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const driverId = String(body?.driverId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(driverId)) return NextResponse.json({ ok: false, error: "Invalid driver." }, { status: 400 });
  const changes: Record<string, string> = {};
  for (const [key, column] of Object.entries(FIELDS)) {
    if (body && key in body) changes[column] = String(body[key] ?? "").trim().slice(0, 60);
  }
  if (!changes.first_name || !changes.last_name) return NextResponse.json({ ok: false, error: "First name and surname are required." }, { status: 400 });
  if (changes.vehicle_year && !/^(19|20)\d{2}$/.test(changes.vehicle_year)) return NextResponse.json({ ok: false, error: "Enter the car year like 2018." }, { status: 400 });
  if (changes.seating_capacity && !/^\d{1,2}$/.test(changes.seating_capacity)) return NextResponse.json({ ok: false, error: "Seats must be a number." }, { status: 400 });
  const { error } = await auth.supabaseAdmin.rpc("moovu_admin_edit_driver", {
    p_actor: auth.user.id, p_driver: driverId, p_changes: changes, p_reason: String(body?.reason ?? "Admin corrected details").slice(0, 500),
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return NextResponse.json({ ok: false, error: "Driver editing isn't switched on yet." }, { status: 503 });
    console.error("[admin-driver-edit] failed", { code: error.code, message: error.message });
    return NextResponse.json({ ok: false, error: "The changes couldn't be saved. Please try again." }, { status: 409 });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
