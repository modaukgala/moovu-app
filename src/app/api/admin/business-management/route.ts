import { NextResponse } from "next/server";
import { isFinancialAdminRole, requireAdminUser } from "@/lib/auth/admin";
import { activitySources, destination, MANAGEMENT_PAGE_SIZE, recordedNumber, recordedText, type ActivitySource, type ManagementActivity } from "@/lib/admin/businessManagement";
import { RIDE_OPTION_RULES, RIDE_OPTIONS, MAX_TRIP_STOPS, STOP_WAITING_FREE_MINUTES, STOP_WAITING_MAX_MINUTES_PER_STOP, STOP_WAITING_MAX_TOTAL_MINUTES } from "@/lib/domain/fare";
import { ADMIN_TRIP_PAYMENT_METHODS } from "@/lib/trips/adminTripPaymentMethod";
import { normalizeCustomerPaymentMethod } from "@/lib/payments/customerPaymentMethod";
import { PHASE6_REQUIRED } from "@/lib/drivers/phase6Policy";
import { PHASE5_POLICY } from "@/lib/finance/phase5Fare";
import { PHASE2_COMMISSION_BASIS_POINTS, phase2Mode } from "@/lib/finance/phase2Policy";
import { SCHEDULED_RIDES_ENABLED, phase6EligibilityEnabled } from "@/lib/release/releaseFlags";
import { isOutboxDeliveryEnabled } from "@/lib/notifications/outboxDelivery";

const json = (body: unknown, status = 200) => NextResponse.json(body, {status,headers:{"Cache-Control":"private, no-store"}});

function configurationState(raw: string | undefined, supported: readonly string[]) {
  if (raw === undefined) return "absent";
  return supported.includes(raw) ? "configured" : "malformed";
}

export async function GET(req: Request) {
  try {
    const session = await requireAdminUser(req);
    if (!session.ok) return json({ok:false,error:session.error},session.status);
    const financial = isFinancialAdminRole(session.profile.role);
    const db = session.supabaseAdmin;
    const params = new URL(req.url).searchParams;
    const section = params.get("section") ?? "policy";
    if (section === "policy") {
      let observed: { state: string; value: object | null } = { state:"unavailable",value:null };
      try {
        const result = await db.rpc("phase5_policy_at", { p_at:new Date().toISOString() });
        const row = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!result.error && (!row || row.version == null && row.effective_from == null &&
            row.membership_price_cents == null && row.membership_days == null &&
            row.go_service_fee_cents == null && row.go_xl_service_fee_cents == null)) {
          observed = { state:"absent",value:null };
        } else if (!result.error && row) {
          const value = {
            version:recordedText(row.version), effectiveFrom:recordedText(row.effective_from),
            membershipPriceCents:recordedNumber(row.membership_price_cents), membershipDays:recordedNumber(row.membership_days),
            goServiceFeeCents:recordedNumber(row.go_service_fee_cents), goXlServiceFeeCents:recordedNumber(row.go_xl_service_fee_cents),
          };
          observed = Object.values(value).some(field=>field===null) || row.currency !== "ZAR" || row.active !== true
            ? { state:"malformed",value:null } : { state:"observed",value };
        }
      } catch { /* Other policy information remains available. */ }
      const eligibilityInput = process.env.NEXT_PUBLIC_MOOVU_PHASE6_NEW_WORK_ELIGIBILITY ?? process.env.MOOVU_PHASE6_NEW_WORK_ELIGIBILITY;
      return json({ok:true,role:session.profile.role,
        reference:{
          services:RIDE_OPTIONS.map(option=>{
            const rules = RIDE_OPTION_RULES[option.id];
            return { id:option.id, name:option.name, baseFare:rules.baseFare, perKm:rules.perKm,
              perMinute:rules.perMinute, minFare:rules.minFare, legacyBookingFee:rules.bookingFee,
              waitingFeePerMinute:rules.waitingFeePerMinute, freeWaitingMinutes:rules.freeWaitingMinutes };
          }),
          stops:{ maximum:MAX_TRIP_STOPS, freeMinutes:STOP_WAITING_FREE_MINUTES, maximumPerStop:STOP_WAITING_MAX_MINUTES_PER_STOP, maximumTotal:STOP_WAITING_MAX_TOTAL_MINUTES },
          customerMethods:["cash","online"].map(normalizeCustomerPaymentMethod).filter(Boolean),
          adminMethods:ADMIN_TRIP_PAYMENT_METHODS,
          membership:{ priceCents:PHASE5_POLICY.membershipPriceCents, days:PHASE5_POLICY.membershipDays,
            goFeeCents:PHASE5_POLICY.goServiceFeeCents, goXlFeeCents:PHASE5_POLICY.goXlServiceFeeCents },
          onboarding:PHASE6_REQUIRED,
        },
        observed,
        features:{ scheduledRides:SCHEDULED_RIDES_ENABLED, phase6Eligibility:phase6EligibilityEnabled(), outboxDeliveryConfigured:isOutboxDeliveryEnabled(),
          eligibilityConfiguration:configurationState(eligibilityInput?.trim().toLowerCase(),["enabled","disabled"]),
          outboxConfiguration:configurationState(process.env.PHASE05_OUTBOX_ENABLED,["true","false"]) },
        ...(financial ? { commission:{ configuredMode:phase2Mode(), configuration:configurationState(process.env.MOOVU_PHASE2_FINANCE_MODE?.trim().toUpperCase(),["OFF","SHADOW","AUTHORITATIVE"]), referenceBasisPoints:Number(PHASE2_COMMISSION_BASIS_POINTS),
          authority:"Recorded trip snapshots and existing financial posting contracts. Effective database posting policy unverified." } } : {}),
      });
    }

    if (!Object.hasOwn(activitySources,section)) return json({ok:false,error:"Invalid management section."},400);
    const source = section as ActivitySource;
    if (activitySources[source].restricted && !financial) return json({ok:false,error:"Owner or Admin access required."},403);
    const page = Number(params.get("page") ?? 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return json({ok:false,error:"Invalid activity page."},400);
    const start = (page-1)*MANAGEMENT_PAGE_SIZE;
    const end = start+MANAGEMENT_PAGE_SIZE-1;
    const sort = { ascending:false, nullsFirst:false };
    const exact = { count:"exact" } as const;
    let result;
    switch (source) {
      case "onboarding": result = await db.from("phase6_reviews").select("id,application_id,source_version,actor_id,action,created_at",exact)
        .order("created_at",sort).order("id",sort).range(start,end); break;
      case "linking": result = await db.from("moovu_business_events").select("id,event_type,actor_id,created_at,driver_id:payload->>driver_id",exact)
        .in("event_type",["driver_link_link","driver_link_unlink","driver_link_approve","driver_link_reject"])
        .order("created_at",sort).order("id",sort).range(start,end); break;
      case "proofs": result = await db.from("driver_payment_requests").select("id,reviewed_by,reviewed_at,status,payment_type",exact)
        .not("reviewed_at","is",null).order("reviewed_at",sort).order("id",sort).range(start,end); break;
      case "settlements": result = await db.from("driver_settlements").select("id,received_by,created_at,driver_id,operation_key,amount_paid",exact)
        .order("created_at",sort).order("id",sort).range(start,end); break;
      case "memberships": result = await db.from("phase5_membership_payments").select("id,reviewed_by,reviewed_at,status,financial_transaction_id",exact)
        .not("reviewed_at","is",null).order("reviewed_at",sort).order("id",sort).range(start,end); break;
      case "cancellations": result = await db.from("phase4_financial_actions").select("id,assessment_id,actor_id,created_at,action_type,phase4_fee_assessments(trip_id)",exact)
        .order("created_at",sort).order("id",sort).range(start,end); break;
    }
    if (result.error || !Array.isArray(result.data) || result.count == null ||
        result.data.length !== Math.max(0, Math.min(MANAGEMENT_PAGE_SIZE,result.count-start))) {
      return json({ok:false,error:"Recorded activity is unavailable."},503);
    }
    const rows:ManagementActivity[] = [];
    for (const row of result.data as Record<string,unknown>[]) {
      const id = recordedText(row.id);
      if (!id) return json({ok:false,error:"Recorded activity identifiers are unavailable."},503);
      const base = { id, actor:recordedText(row.actor_id ?? row.reviewed_by ?? row.received_by),
        at:recordedText(row.reviewed_at ?? row.created_at) };
      switch (source) {
        case "onboarding": rows.push({...base,action:recordedText(row.action) ?? "Unknown",entity:recordedText(row.application_id),
          detail:recordedNumber(row.source_version) === null ? null : `Submitted version ${row.source_version}`,
          href:destination("/admin/onboarding",row.application_id,"?id=")}); break;
        case "linking": rows.push({...base,action:recordedText(row.event_type) ?? "Unknown",entity:recordedText(row.driver_id),
          detail:null,href:destination("/admin/drivers/",row.driver_id)}); break;
        case "proofs": rows.push({...base,action:recordedText(row.status) ?? "Unknown",entity:id,
          detail:recordedText(row.payment_type),href:destination("/admin/payment-receipts/",id)}); break;
        case "settlements": rows.push({...base,action:"Recorded commission collection",entity:recordedText(row.driver_id),
          detail:[recordedText(row.operation_key),typeof row.amount_paid==="number" && Number.isFinite(row.amount_paid) ? `ZAR ${row.amount_paid.toFixed(2)}` : null].filter(Boolean).join(" · ") || null,
          href:destination("/admin/drivers/",row.driver_id)}); break;
        case "memberships": rows.push({...base,action:recordedText(row.status) ?? "Unknown",entity:id,
          detail:recordedText(row.financial_transaction_id),href:"/admin/moovu-plus"}); break;
        case "cancellations": {
          const relation = row.phase4_fee_assessments as { trip_id?: unknown } | null;
          rows.push({...base,action:recordedText(row.action_type) ?? "Unknown",entity:recordedText(row.assessment_id),
            detail:null,href:destination("/admin/trips/",relation?.trip_id)});
          break;
        }
      }
    }
    if (new Set(rows.map(row=>row.id)).size !== rows.length) return json({ok:false,error:"Duplicate activity identifiers."},503);
    return json({ok:true,section:source,rows,total:result.count,page,pageSize:MANAGEMENT_PAGE_SIZE});
  } catch {
    return json({ok:false,error:"Business management evidence is unavailable."},503);
  }
}
