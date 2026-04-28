import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { isDriverSubscriptionPlan } from "@/lib/finance/driverPayments";

type SubscriptionPatch = {
  subscription_status: string;
  subscription_expires_at: string | null;
  subscription_plan: string | null;
};

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.status }
      );
    }

    const { supabaseAdmin } = auth;
    const body = await req.json().catch(() => null);

    const driverId = String(body && typeof body === "object" && "driverId" in body ? body.driverId : "").trim();
    const action = String(body && typeof body === "object" && "action" in body ? body.action : "").trim();
    const days = body && typeof body === "object" && "days" in body && body.days != null ? Number(body.days) : null;
    const note = body && typeof body === "object" && "note" in body && body.note ? String(body.note) : null;
    const planRaw = body && typeof body === "object" && "plan" in body && body.plan ? String(body.plan) : null;
    const expiryIso = body && typeof body === "object" && "expiry" in body && body.expiry ? String(body.expiry) : null;

    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Missing driverId" }, { status: 400 });
    }

    const { data: driver, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id,subscription_status,subscription_expires_at,subscription_plan")
      .eq("id", driverId)
      .single();

    if (dErr || !driver) {
      return NextResponse.json({ ok: false, error: dErr?.message ?? "Driver not found" }, { status: 404 });
    }

    const oldStatus = driver.subscription_status ?? "inactive";
    const oldExp = driver.subscription_expires_at ? new Date(driver.subscription_expires_at) : null;

    let newStatus = oldStatus;
    let newExp: Date | null = oldExp;
    let newPlan = driver.subscription_plan ?? null;

    if (planRaw) {
      if (!isDriverSubscriptionPlan(planRaw)) {
        return NextResponse.json({ ok: false, error: "Invalid subscription plan." }, { status: 400 });
      }
      newPlan = planRaw;
    }

    if (action === "activate") {
      newStatus = "active";
      if (!newExp) newExp = addDays(new Date(), 30);
    } else if (action === "suspend") {
      newStatus = "suspended";
    } else if (action === "inactive") {
      newStatus = "inactive";
    } else if (action === "grace") {
      newStatus = "grace";
    } else if (action === "extend") {
      if (!days || days <= 0) {
        return NextResponse.json({ ok: false, error: "days must be > 0 for extend" }, { status: 400 });
      }
      const base = newExp && newExp.getTime() > Date.now() ? newExp : new Date();
      newExp = addDays(base, days);
      newStatus = "active";
    } else if (action === "set_expiry") {
      if (!expiryIso) {
        return NextResponse.json({ ok: false, error: "Missing expiry" }, { status: 400 });
      }
      newExp = new Date(expiryIso);
      if (isNaN(newExp.getTime())) {
        return NextResponse.json({ ok: false, error: "Invalid expiry date" }, { status: 400 });
      }
    } else {
      return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
    }

    const patch: SubscriptionPatch = {
      subscription_status: newStatus,
      subscription_expires_at: newExp ? newExp.toISOString() : null,
      subscription_plan: newPlan,
    };

    const { error: upErr } = await supabaseAdmin.from("drivers").update(patch).eq("id", driverId);
    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }

    await supabaseAdmin.from("driver_subscription_events").insert({
      driver_id: driverId,
      actor: "admin",
      action,
      old_status: oldStatus,
      new_status: newStatus,
      old_expires_at: oldExp ? oldExp.toISOString() : null,
      new_expires_at: newExp ? newExp.toISOString() : null,
      note,
    });

    return NextResponse.json({
      ok: true,
      status: newStatus,
      expires_at: newExp ? newExp.toISOString() : null,
    });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Server error" }, { status: 500 });
  }
}
