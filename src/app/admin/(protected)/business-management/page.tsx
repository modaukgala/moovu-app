"use client";

import Link from "next/link";
import { useCallback, useContext, useState } from "react";
import { AdminRoleContext } from "@/lib/admin/adminRoleContext";
import { activitySources, MANAGEMENT_PAGE_SIZE, type ActivitySource, type ManagementActivity } from "@/lib/admin/businessManagement";
import { readFinancialJson, useFinancialRead } from "@/lib/admin/useFinancialRead";
import { supabaseClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/MoovuPrimitives";
import ManualSurgeControl from "@/components/admin/ManualSurgeControl";
import { AdminPagination, AdminTableRegion } from "@/components/admin/AdminResults";

type Policy = {
  role: string;
  reference: {
    services: { id:string; name:string; baseFare:number; perKm:number; perMinute:number; minFare:number; legacyBookingFee:number; waitingFeePerMinute:number; freeWaitingMinutes:number }[];
    stops: { maximum:number; freeMinutes:number; maximumPerStop:number; maximumTotal:number };
    customerMethods: string[]; adminMethods: string[];
    membership: { priceCents:number; days:number; goFeeCents:number; goXlFeeCents:number };
    onboarding: Record<string,string[]>;
  };
  observed: { state:string; value:null | { version:string; effectiveFrom:string; membershipPriceCents:number; membershipDays:number; goServiceFeeCents:number; goXlServiceFeeCents:number } };
  features: { scheduledRides:boolean; phase6Eligibility:boolean; outboxDeliveryConfigured:boolean; eligibilityConfiguration:string; outboxConfiguration:string };
  commission?: { configuredMode:string; configuration:string; referenceBasisPoints:number; authority:string };
};
type ActivityResult = { rows:ManagementActivity[]; total:number; page:number; pageSize:number };
type Maps = { local:{ generatedAt:string; operations:Record<string,{ providerSuccesses:number; providerFailures:number; providerCallsLastMinute:number }> };
  shared:{operation:string; status:string; request_count:number}[] | null; sharedSince:string };
type Recovery = { jobs:{id:string; trip_id:string|null; status:string; attempts:number; created_at:string; last_attempt_at:string|null}[];
  limit:number; observedAt:string; scope:"recent" };

async function token() {
  const {data:{session}} = await supabaseClient.auth.getSession();
  return session?.access_token ?? null;
}

const cents = (value:number) => `R${(value/100).toFixed(2)}`;
const enabled = (value:boolean) => value ? "Enabled" : "Disabled";
const workflowLinks = [
  ["Active trips","/admin/dispatch?queue=active"],["Unassigned trips","/admin/dispatch?queue=unassigned"],
  ["Driver applications","/admin/applications"],["Notification Diagnostics","/admin/notifications"],
] as const;
const restrictedLinks = [
  ["Onboarding Review","/admin/onboarding?status=NEEDS_REVIEW"],["Pending payment proofs","/admin/payment-reviews"],
  ["Awaiting payment confirmation","/admin/payment-reviews?status=waiting_confirmation"],
  ["Yoco fulfilment exceptions","/admin/online-payments#fulfilment"],
  ["Commission settlements","/admin/settlements"],["Financial reconciliation reports","/admin/reports"],
  ["MOOVU+ management","/admin/moovu-plus"],
] as const;

function ReadStatus({ loading, error, retry }: {loading:boolean; error?:string; retry:()=>void}) {
  if (loading) return <p role="status">Loading recorded information…</p>;
  return error ? <p role="alert">{error} <button type="button" className="underline" onClick={retry}>Retry this section</button></p> : null;
}

function PolicySection() {
  const readPolicy = useCallback(async (_:string,signal:AbortSignal)=>readFinancialJson<Policy>(
    "/api/admin/business-management",await token(),signal,body=>{
      const reference = body.reference as Policy["reference"] | undefined;
      const observed = body.observed as Policy["observed"] | undefined;
      return Array.isArray(reference?.services) && Array.isArray(reference.customerMethods) && Array.isArray(reference.adminMethods) &&
        Boolean(reference.stops && reference.membership && reference.onboarding && body.features && observed?.state);
    }),[]);
  const result = useFinancialRead("policy",readPolicy);
  const policy = result.data;
  return <section className="space-y-3">
    <h2 className="text-xl font-semibold">Policy and availability</h2>
    <ReadStatus {...result} />
    {policy && !result.error && <>
      <p>Authenticated role: {policy.role}. Policy and availability information is read-only.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {policy.reference.services.map(service=><article key={service.id} className="moovu-card p-4 space-y-2">
          <h3 className="font-semibold">{service.name}</h3>
          <p>Checked-in fare reference · {service.id}</p>
          <p>Base R{service.baseFare} · minimum R{service.minFare} · R{service.perKm}/km · R{service.perMinute}/min</p>
          <p>Legacy booking fee R{service.legacyBookingFee} · waiting R{service.waitingFeePerMinute}/min after {service.freeWaitingMinutes} free minutes.</p>
        </article>)}
        <article className="moovu-card p-4 space-y-2">
          <h3 className="font-semibold">Stops and supported payment methods</h3>
          <p>{policy.reference.stops.maximum} stops · {policy.reference.stops.freeMinutes} free waiting minutes · maximum {policy.reference.stops.maximumPerStop} minutes per stop and {policy.reference.stops.maximumTotal} total.</p>
          <p>Customer booking: {policy.reference.customerMethods.join(", ")}. Admin booking: {policy.reference.adminMethods.join(", ")}.</p>
          <Link href="/admin#manual-surge" className="underline">Open manual surge control</Link>
        </article>
        <article className="moovu-card p-4 space-y-2">
          <h3 className="font-semibold">Booking fees and membership</h3>
          <p>Checked-in reference: Go {cents(policy.reference.membership.goFeeCents)}, Go XL {cents(policy.reference.membership.goXlFeeCents)}; membership {cents(policy.reference.membership.priceCents)} for {policy.reference.membership.days} days.</p>
          {policy.observed.value ? <p>Observed database policy {policy.observed.value.version} since {policy.observed.value.effectiveFrom}. Go {cents(policy.observed.value.goServiceFeeCents)}, Go XL {cents(policy.observed.value.goXlServiceFeeCents)}; membership {cents(policy.observed.value.membershipPriceCents)} for {policy.observed.value.membershipDays} days.</p>
            : <p>Effective database policy: {policy.observed.state}.</p>}
        </article>
        <article className="moovu-card p-4 space-y-2">
          <h3 className="font-semibold">Onboarding and release state</h3>
          <ul className="list-disc pl-5">{Object.entries(policy.reference.onboarding).map(([section, fields])=><li key={section}>{section}: {fields.join(", ")}</li>)}</ul>
          <p>Insurance and PDP uploads can be submitted outside the required upload checklist. Existing PDP and legal requirements still apply. Owner and Admin review decisions. Account linking and operating status are separate.</p>
          <p>Phase 6 new-work eligibility: {enabled(policy.features.phase6Eligibility)} ({policy.features.eligibilityConfiguration} configuration). Scheduled ride booking: {enabled(policy.features.scheduledRides)} (checked-in gate). Outbox switch: {enabled(policy.features.outboxDeliveryConfigured)} ({policy.features.outboxConfiguration} configuration).</p>
          <p>Resolved settings do not establish backing schema availability or successful delivery.</p>
        </article>
        {policy.commission && <article className="moovu-card p-4 space-y-2">
          <h3 className="font-semibold">Commission policy</h3>
          <p>Checked-in Phase 2 reference: {policy.commission.referenceBasisPoints / 100}% · resolved configured mode: {policy.commission.configuredMode} ({policy.commission.configuration} configuration).</p>
          <p>{policy.commission.authority}</p>
        </article>}
      </div>
    </>}
  </section>;
}

function Activity({ source }: {source:ActivitySource}) {
  const [page,setPage] = useState(1);
  const readActivity = useCallback(async (key:string,signal:AbortSignal)=>readFinancialJson<ActivityResult>(
    `/api/admin/business-management?${key}`,await token(),signal,
    body=>Array.isArray(body.rows) && body.rows.every(row=>typeof row?.id === "string" && typeof row.action === "string") &&
      Number.isSafeInteger(body.total) && Number.isSafeInteger(body.page) && body.pageSize === MANAGEMENT_PAGE_SIZE),[]);
  const result = useFinancialRead(new URLSearchParams({section:source,page:String(page)}).toString(),readActivity);
  return <article className="moovu-card space-y-3 p-4">
    <h3 className="font-semibold">{activitySources[source].label}</h3>
    <p className="text-sm">{activitySources[source].evidence}</p>
    <ReadStatus {...result} />
    {result.data && !result.error && <>
      <AdminPagination label={activitySources[source].label} page={page} count={result.data.total}
        busy={result.loading} hasNext={page*MANAGEMENT_PAGE_SIZE<result.data.total} onPage={setPage} />
      {result.data.rows.length ? <AdminTableRegion label={activitySources[source].label}>
        <table className="w-full min-w-[640px] text-left text-sm [&_td]:break-all [&_td]:p-2 [&_th]:p-2">
          <thead><tr>{["Decision or action","Recorded at","Actor","Record","Related record","Context"].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{result.data.rows.map(row=><tr className="border-t" key={row.id}><td>{row.action}</td><td>{row.at ?? "Unknown"}</td><td>{row.actor ?? "Unknown"}</td>
            <td>{row.id}</td><td>{row.entity ?? "Unknown"}</td><td>{row.detail ?? ""}{row.href && <div><Link className="underline" href={row.href}>Open related record</Link></div>}</td></tr>)}</tbody>
        </table>
      </AdminTableRegion> : <p>No recorded activity on this page.</p>}
    </>}
  </article>;
}

function MapsDiagnostics() {
  const readMaps = useCallback(async (_:string,signal:AbortSignal)=>readFinancialJson<Maps>(
    "/api/admin/maps/usage?summary=1",await token(),signal,
    body=>Boolean((body.local as Maps["local"] | undefined)?.operations) && (body.shared === null || Array.isArray(body.shared))),[]);
  const maps = useFinancialRead("maps",readMaps);
  return <article className="moovu-card p-4 space-y-2">
    <h3 className="font-semibold">Recorded Maps usage</h3>
    <ReadStatus {...maps} />
    {maps.data && !maps.error && <>
      <p>Current server process · observed {maps.data.local.generatedAt}. This snapshot represents this process only.</p>
      <ul>{Object.entries(maps.data.local.operations).map(([operation,row])=><li key={operation}>{operation}: {row.providerSuccesses} provider successes, {row.providerFailures} failures, {row.providerCallsLastMinute} calls in the last minute.</li>)}</ul>
      <p>Shared telemetry since {maps.data.sharedSince}</p>
      {maps.data.shared === null ? <p>Shared telemetry unavailable.</p> : maps.data.shared.length === 0 ? <p>No shared telemetry in this window.</p>
        : <ul>{maps.data.shared.map(row=><li key={`${row.operation}:${row.status}`}>{row.operation} · {row.status}: {row.request_count}</li>)}</ul>}
    </>}
  </article>;
}

function RecoveryDiagnostics() {
  const readRecovery = useCallback(async (_:string,signal:AbortSignal)=>readFinancialJson<Recovery>(
    "/api/admin/phase2-finance/recovery?summary=1",await token(),signal,
    body=>Array.isArray(body.jobs) && body.scope==="recent" && Number.isSafeInteger(body.limit)),[]);
  const recovery = useFinancialRead("recovery",readRecovery);
  return <article className="moovu-card p-4 space-y-2">
    <h3 className="font-semibold">Recent recorded financial recovery jobs</h3>
    <ReadStatus {...recovery} />
    {recovery.data && !recovery.error && <>
      <p>Up to {recovery.data.limit} recent records · observed {recovery.data.observedAt}. Total backlog is unavailable from this read.</p>
      {!recovery.data.jobs.length ? <p>No recent recovery jobs recorded.</p> : <ul className="divide-y">
        {recovery.data.jobs.map(job=><li key={job.id} className="py-2 break-all">{job.status} · {job.attempts} attempts · created {job.created_at} · last attempt {job.last_attempt_at ?? "Unavailable"}
          {job.trip_id && <> · <Link className="underline" href={`/admin/trips/${encodeURIComponent(job.trip_id)}`}>Open trip</Link></>}</li>)}
      </ul>}
    </>}
  </article>;
}

export default function BusinessManagementPage() {
  const role = useContext(AdminRoleContext);
  const financial = role==="owner" || role==="admin";
  return <main className="min-w-0 space-y-6">
    <PageHeader kicker="Growth" title="Pricing & settings" description="Busy-time pricing, the prices and fees in use, and a record of admin activity." />
    <ManualSurgeControl />
    <PolicySection key={role ?? "unresolved"} />
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Recorded activity</h2>
      <p>Each source has independent coverage and pagination.</p>
      {(Object.keys(activitySources) as ActivitySource[]).filter(source=>financial || !activitySources[source].restricted)
        .map(source=><Activity source={source} key={source} />)}
    </section>
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Diagnostics and exceptions</h2>
      <ul className="moovu-card grid gap-2 p-4 sm:grid-cols-2">
        {[...workflowLinks,...(financial ? restrictedLinks : [])].map(([label,href])=><li key={href}><Link className="underline" href={href}>{label}</Link></li>)}
      </ul>
      <MapsDiagnostics />
      {financial && <RecoveryDiagnostics />}
    </section>
  </main>;
}
