import { NextResponse } from "next/server";
import {
  buildTripShareMessage,
  formatVehicleLabel,
  fullCustomerName,
  normalizePhoneZA,
} from "@/lib/customer/auth";
import { getAuthenticatedCustomer } from "@/lib/customer/server";
import { waLinkZA } from "@/lib/whatsapp";

export async function POST(req: Request) {
  try {
    const auth = await getAuthenticatedCustomer(req);

    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await req.json();

    const tripId = String(body?.tripId ?? "").trim();
    const friendName = String(body?.friendName ?? "").trim();
    const friendPhone = normalizePhoneZA(body?.friendPhone);
    const shareMethod = String(body?.shareMethod ?? "system_share").trim();

    if (!tripId) {
      return NextResponse.json(
        { ok: false, error: "Trip ID is required." },
        { status: 400 }
      );
    }

    const { data: trip, error: tripError } = await auth.supabaseAdmin
      .from("trips")
      .select(`
        id,
        customer_id,
        status,
        start_otp_verified,
        dropoff_address,
        driver_id
      `)
      .eq("id", tripId)
      .eq("customer_id", auth.customer.id)
      .maybeSingle();

    if (tripError) {
      return NextResponse.json({ ok: false, error: tripError.message }, { status: 500 });
    }

    if (!trip) {
      return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
    }

    if (!trip.start_otp_verified || trip.status !== "ongoing") {
      return NextResponse.json(
        {
          ok: false,
          error: "Trip can only be shared after it has started and the OTP has been verified.",
        },
        { status: 400 }
      );
    }

    if (!trip.driver_id) {
      return NextResponse.json(
        { ok: false, error: "Driver details are not available yet." },
        { status: 400 }
      );
    }

    const { data: driver, error: driverError } = await auth.supabaseAdmin
      .from("drivers")
      .select(`
        id,
        first_name,
        last_name,
        phone,
        vehicle_make,
        vehicle_model,
        vehicle_color,
        vehicle_registration
      `)
      .eq("id", trip.driver_id)
      .maybeSingle();

    if (driverError || !driver) {
      return NextResponse.json(
        { ok: false, error: driverError?.message || "Driver details not found." },
        { status: 500 }
      );
    }

    const origin = new URL(req.url).origin;
    const shareToken = crypto.randomUUID();
    const shareUrl = `${origin}/shared-trip/${shareToken}`;

    const customerName = fullCustomerName(auth.customer.first_name, auth.customer.last_name);
    const driverName = fullCustomerName(driver.first_name, driver.last_name);
    const vehicleLabel = formatVehicleLabel(driver);

    const shareMessage = buildTripShareMessage({
      customerName,
      destination: trip.dropoff_address || "their destination",
      driverName,
      driverPhone: driver.phone,
      vehicleLabel,
      shareUrl,
    });

    const { error: shareError } = await auth.supabaseAdmin
      .from("trip_shares")
      .insert({
        trip_id: trip.id,
        customer_id: auth.customer.id,
        friend_name: friendName || null,
        friend_phone: friendPhone || null,
        share_method: shareMethod || "system_share",
        share_message: shareMessage,
        share_token: shareToken,
        is_active: true,
      });

    if (shareError) {
      return NextResponse.json({ ok: false, error: shareError.message }, { status: 500 });
    }

    const whatsappUrl = friendPhone ? waLinkZA(friendPhone, shareMessage) : null;
    const smsUrl = friendPhone
      ? `sms:${friendPhone.replace(/\D/g, "")}?body=${encodeURIComponent(shareMessage)}`
      : null;

    return NextResponse.json({
      ok: true,
      message: "Trip share message prepared successfully.",
      shareUrl,
      shareMessage,
      whatsappUrl,
      smsUrl,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Server error." },
      { status: 500 }
    );
  }
}