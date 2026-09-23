import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveDriverFinanceAuthority } from "@/lib/finance/phase2DriverEligibility";
import { phase6NewWork } from "@/lib/drivers/phase6NewWork";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error";
}

async function getUserFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) return null;
  return data?.user ?? null;
}

export async function POST(req: Request) {
  try {
    const user = await getUserFromBearer(req);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }

    const { online } = await req.json();
    const wantOnline = !!online;

    const { data: mapping, error: mErr } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .single();

    if (mErr) {
      return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });
    }

    const driverId = mapping?.driver_id ?? null;
    if (!driverId) {
      return NextResponse.json({ ok: false, error: "Not linked" }, { status: 403 });
    }

    await supabaseAdmin.rpc("refresh_driver_subscription", { did: driverId });

    const { data: driver, error: dErr } = await supabaseAdmin
      .from("drivers")
      .select("id,status,subscription_status,subscription_expires_at,profile_completed")
      .eq("id", driverId)
      .single();

    if (dErr || !driver) {
      return NextResponse.json({ ok: false, error: "Driver not found" }, { status: 404 });
    }

    if (wantOnline) {
      const onboarding = await phase6NewWork(supabaseAdmin, driverId);
      if (!onboarding.ok || !onboarding.eligible) return NextResponse.json({ ok: false, error: onboarding.error }, { status: onboarding.ok ? 403 : 503 });
      if (!driver.profile_completed) {
        return NextResponse.json(
          { ok: false, error: "Complete your profile before going online." },
          { status: 403 }
        );
      }

      if (driver.status !== "approved" && driver.status !== "active") {
        return NextResponse.json(
          { ok: false, error: "Driver not approved" },
          { status: 403 }
        );
      }

      const { data: wallet, error: walletError } = await supabaseAdmin
        .from("driver_wallets").select("balance_due").eq("driver_id", driverId).maybeSingle();
      if (walletError) return NextResponse.json({ ok: false, error: walletError.message }, { status: 500 });
      const finance = await resolveDriverFinanceAuthority(supabaseAdmin, {
        driverId, subscriptionStatus: driver.subscription_status,
        subscriptionExpiresAt: driver.subscription_expires_at,
        legacyBalanceDue: Number(wallet?.balance_due ?? 0),
      });
      if (!finance.ok) return NextResponse.json({ ok: false, error: finance.error, code: finance.code }, { status: 503 });
      if (!finance.authority.financiallyEligible) {
        await supabaseAdmin
          .from("drivers")
          .update({
            online: false,
            busy: false,
            last_seen: new Date().toISOString(),
          })
          .eq("id", driverId);

        return NextResponse.json(
          {
            ok: false,
            error: finance.authority.subscriptionRequired
              ? "Your subscription must be active and commission balance cleared before going online."
              : `Your Phase 2 commission debt is R${(finance.authority.netOwedCents / 100).toFixed(2)}. Pay it below R${(finance.authority.thresholdCents / 100).toFixed(2)} before going online.`,
          },
          { status: 402 }
        );
      }

    }

    const { error: upErr } = await supabaseAdmin
      .from("drivers")
      .update({
        online: wantOnline,
        last_seen: new Date().toISOString(),
      })
      .eq("id", driverId);

    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, online: wantOnline });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}
