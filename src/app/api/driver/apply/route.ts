import { phase6LegacyMutation } from "@/lib/drivers/phase6LegacyRoutes";
import { NextResponse } from "next/server";
import { notifyAdmins } from "@/lib/push-notify";
import {
  isValidEmail, isValidEngineNumber, isValidSaIdNumber, isValidSaMobile, isValidSeatingCapacity,
  isValidVehicleRegistration, isValidVehicleYear, isValidVin, normalizeEngineNumber, normalizeSaPhone,
  normalizeVehicleRegistration, normalizeVin,
} from "@/lib/driver-validation";
import { getDriverRideEligibility } from "@/lib/drivers/rideEligibility";
import { getUserFromBearer } from "@/app/api/driver/utils";
import { applicationIdentity } from "@/lib/drivers/applicationIdentity";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { callHardenedRpc } from "@/lib/server/hardenedRpc";
import { isOutboxDeliveryEnabled } from "@/lib/notifications/outboxDelivery";

type ApplicantResult = { driver_id: string; application_id: string; replayed: boolean };
const fail = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  const retirement = phase6LegacyMutation(req);
  if (retirement) return retirement;
  try {
    const user = await getUserFromBearer(req);
    if (!user) return fail("Sign in to submit your driver application.", 401);
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return fail("Application details are required.");
    const identity = applicationIdentity(user, body.userId ?? body.userid, body.email);
    if (!identity.ok) return fail(identity.error, identity.status);
    const { userId, email } = identity;
    const rawFullName = String(body.fullName ?? "").trim();
    const phone = normalizeSaPhone(body.phone);
    const notes = String(body.notes ?? "").trim();
    const applicationData = body.applicationData && typeof body.applicationData === "object" ? body.applicationData : {};
    const eligibility = applicationData.eligibility ?? {};
    const personal = applicationData.personal ?? {};
    const vehicle = applicationData.vehicle ?? {};
    const pdpStatus = String(body.pdpStatus ?? eligibility.pdpStatus ?? "not_available_yet");
    if (!isValidEmail(email)) return fail("Enter a valid email address.");
    if (!isValidSaMobile(phone)) return fail("Enter a valid South African cellphone number.");
    if (personal.idNumber && !isValidSaIdNumber(personal.idNumber)) return fail("SA ID number must be exactly 13 digits.");
    if (vehicle.year && !isValidVehicleYear(vehicle.year)) return fail("Vehicle year must be between 1995 and next year.");
    if (vehicle.plate && !isValidVehicleRegistration(vehicle.plate)) return fail("Number plate must be 3 to 15 letters/numbers, spaces, or hyphens.");
    if (vehicle.vin && !isValidVin(vehicle.vin)) return fail("VIN must be exactly 17 characters and cannot contain I, O, or Q.");
    if (vehicle.engineNumber && !isValidEngineNumber(vehicle.engineNumber)) return fail("Engine number must be 6 to 25 uppercase letters/numbers.");
    if (vehicle.seatingCapacity && !isValidSeatingCapacity(vehicle.seatingCapacity)) return fail("Seating capacity must be between 3 and 7.");

    const fullName = rawFullName || "Unnamed Driver";
    const parts = fullName.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || "Unnamed";
    const lastName = parts.slice(1).join(" ") || "Driver";
    const seatingCapacity = Number(vehicle.seatingCapacity);
    const rideEligibility = getDriverRideEligibility(Number.isFinite(seatingCapacity) ? seatingCapacity : null);
    const structuredNotes = [
      notes, "MOOVU guided application summary:",
      `Readiness score: ${Number(applicationData.readinessScore ?? 0)}%`,
      `PDP / PrDP status: ${pdpStatus}`,
      `Valid licence: ${eligibility.validLicence ?? "unknown"}`,
      `Vehicle access: ${eligibility.vehicleAccess ?? "unknown"}`,
      `Operating area: ${eligibility.operatingArea ?? "not captured"}`,
      `Vehicle ownership: ${eligibility.ownershipType ?? vehicle.ownershipType ?? "not captured"}`,
      `Automatic ride eligibility: ${rideEligibility.labels.join(", ")}`,
      `Seating-capacity review required: ${rideEligibility.reviewRequired ? "yes" : "no"}`,
    ].filter(Boolean).join("\n");

    const result = await callHardenedRpc<ApplicantResult>(supabaseAdmin, "phase05b_submit_driver_application", {
      p_user_id: userId,
      p_payload: {
        email, phone, first_name: firstName, last_name: lastName, notes: structuredNotes,
        id_number: personal.idNumber ? String(personal.idNumber).trim() : null,
        home_address: personal.address ? String(personal.address).trim() : null,
        area_name: eligibility.operatingArea ? String(eligibility.operatingArea).trim() : null,
        emergency_name: personal.emergencyName ? String(personal.emergencyName).trim() : null,
        emergency_phone: personal.emergencyPhone ? String(personal.emergencyPhone).trim() : null,
        vehicle_make: vehicle.make ? String(vehicle.make).trim() : null,
        vehicle_model: vehicle.model ? String(vehicle.model).trim() : null,
        vehicle_year: vehicle.year ? String(vehicle.year).trim() : null,
        vehicle_color: vehicle.color ? String(vehicle.color).trim() : null,
        vehicle_registration: vehicle.plate ? normalizeVehicleRegistration(vehicle.plate) : null,
        vehicle_vin: vehicle.vin ? normalizeVin(vehicle.vin) : null,
        vehicle_engine_number: vehicle.engineNumber ? normalizeEngineNumber(vehicle.engineNumber) : null,
        seating_capacity: Number.isFinite(seatingCapacity) ? seatingCapacity : null,
      },
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
    if (!result.result.replayed && !isOutboxDeliveryEnabled()) {
      await notifyAdmins("New driver application", `${fullName} submitted a driver application.`, "/admin/applications")
        .catch(() => console.warn("[driver-apply] post-commit notification deferred"));
    }
    return NextResponse.json({ ok: true, driverId: result.result.driver_id, applicationId: result.result.application_id,
      replayed: result.result.replayed, message: "Application submitted successfully." });
  } catch (error: unknown) {
    return fail(error instanceof Error ? error.message : "Server error", 500);
  }
}
