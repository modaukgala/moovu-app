"use client";

import { useCallback, useContext, useState } from "react";
import { AdminRoleContext } from "@/lib/admin/adminRoleContext";
import { aggregateCsv, biPeriod, metric, type BIPeriod, type Metric, type tripSeries } from "@/lib/admin/businessIntelligence";
import { readFinancialJson, useFinancialRead } from "@/lib/admin/useFinancialRead";
import { supabaseClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/MoovuPrimitives";
import MetricCard from "@/components/ui/MetricCard";
import { AdminTableRegion } from "@/components/admin/AdminResults";

type Operations = {
  period: BIPeriod; overview: Metric[]; demand: Metric[]; service: Metric[];
  series: ReturnType<typeof tripSeries>; reasons: [string,number][] | null; actors: [string,number][] | null;
  coverage: { bookings:boolean; completions:boolean; cancellations:boolean; offers:boolean };
};
type LedgerSection = { value: number | null; complete: boolean } | null;
type Financial = {
  period:{ from:string; to:string }; asOf:string;
  trips: { gross:number|null; commission:number|null; net:number|null; count:number } | null;
  direct: LedgerSection; debt: LedgerSection; subscriptions: LedgerSection; membership: LedgerSection;
  online: { customerTrips:number } | null;
};

function validOperations(body: Record<string,unknown>) {
  const period = body.period as BIPeriod | undefined;
  const series = body.series as Operations["series"] | undefined;
  const rows = (value: unknown) => value === null || Array.isArray(value) && value.every(row =>
    Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "number");
  const cards = (value: unknown) => Array.isArray(value) && value.every(card => card && typeof card.label === "string" &&
    (card.value === null || typeof card.value === "number") && typeof card.unit === "string" && typeof card.coverage === "string");
  return typeof period?.from === "string" && typeof period.to === "string" && typeof period.observation === "string" &&
    typeof period.previous?.from === "string" && typeof period.previous.to === "string" &&
    cards(body.overview) && cards(body.demand) && cards(body.service) && Array.isArray(series?.days) &&
    series.days.every(row => row && typeof row.date === "string") &&
    Array.isArray(series.hours) && Array.isArray(series.weekdays) &&
    Boolean(series.categories && series.completedCategories && series.methods && body.coverage) &&
    rows(body.reasons) && rows(body.actors);
}

async function token() {
  const {data:{session}} = await supabaseClient.auth.getSession();
  return session?.access_token ?? null;
}

function Cards({ metrics }: { metrics:Metric[] }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {metrics.map(({ label,value,unit,denominator,coverage })=><MetricCard key={label} label={label}
      value={value === null ? "Unavailable" : unit==="ZAR" ? `R${value.toLocaleString("en-ZA",{minimumFractionDigits:2,maximumFractionDigits:2})}` :
        `${value.toLocaleString("en-ZA",{maximumFractionDigits:2})}${unit==="count" ? "" : " "+unit}`}
      helper={denominator === undefined ? coverage : `${coverage} · ${denominator} records or eligible units`} />)}
  </div>;
}

function Series({ title, rows }: { title:string; rows:[string,number][] | null }) {
  const max = Math.max(1,...(rows ?? []).map(([,value])=>value));
  return <section className="moovu-card space-y-3 p-4">
    <h3 className="font-semibold">{title}</h3>
    {!rows ? <p>Unavailable for this period.</p> : <AdminTableRegion label={title}>
      <table className="w-full text-left text-sm">
        <thead><tr><th scope="col">Group</th><th scope="col">Count</th><th scope="col"><span className="sr-only">Relative volume</span></th></tr></thead>
        <tbody>{rows.map(([label,value])=><tr key={label} className="border-t">
          <th scope="row" className="py-1 pr-3 font-normal">{label}</th><td className="pr-3">{value}</td>
          <td className="w-1/2"><div aria-hidden="true" className="h-2 rounded bg-sky-600" style={{width:`${value/max*100}%`}} /></td>
        </tr>)}</tbody>
      </table>
      {rows.length===0 && <p>No recorded groups in this period.</p>}
    </AdminTableRegion>}
  </section>;
}

function financialCards(result: Financial): Metric[] {
  const trips = result.trips;
  return [
    metric("Gross recorded completed fares",trips?.gross ?? null,"ZAR"),
    metric("Accrued MOOVU commission",trips?.commission ?? null,"ZAR"),
    metric("Recorded driver net earnings",trips?.net ?? null,"ZAR"),
    metric("Average completed ride value",trips?.gross != null && trips.count > 0 ? trips.gross/trips.count : null,"ZAR",trips?.count),
    metric("Recorded commission collections",result.direct?.value ?? null,"ZAR"),
    metric("Current outstanding commission",result.debt?.value ?? null,"ZAR",undefined,`Current balance · observed ${result.asOf}`),
    metric("Verified online customer receipts",result.online?.customerTrips ?? null,"ZAR"),
    metric("Recorded historical subscription receipts",result.subscriptions?.value ?? null,"ZAR"),
    metric("Approved MOOVU+ payments with posted evidence",result.membership?.value ?? null,"ZAR"),
  ];
}

export default function BusinessIntelligencePage() {
  const role = useContext(AdminRoleContext);
  const financial = role==="owner" || role==="admin";
  const [preset,setPreset] = useState("thirty");
  const [dates,setDates] = useState({from:"",to:""});
  const [selection,setSelection] = useState(()=>biPeriod(new URLSearchParams()));
  const [formError,setFormError] = useState<string|null>(null);
  const key = new URLSearchParams({preset:"custom",from:selection.from,to:selection.to}).toString();
  const readOps = useCallback(async(key:string,signal:AbortSignal)=>
    readFinancialJson<Operations>(`/api/admin/business-intelligence?${key}`,await token(),signal,
      validOperations),[]);
  const readFinance = useCallback(async(key:string,signal:AbortSignal)=>
    key ? readFinancialJson<Financial>(`/api/admin/earnings?${key}`,await token(),signal,body=>typeof body.asOf==="string" && Boolean(body.period) && Object.hasOwn(body,"trips")) : null,[]);
  const ops = useFinancialRead(key,readOps);
  const amounts = useFinancialRead(financial ? key : "",readFinance);
  const data = ops.data;
  const financialData = financial && amounts.data && amounts.data.period.from === selection.from && amounts.data.period.to === selection.to ? amounts.data : null;
  const money = financialData ? financialCards(financialData) : [];
  function exportSummary() {
    if (!data || ops.loading || ops.error || data.period.from!==selection.from || data.period.to!==selection.to) return;
    const url = URL.createObjectURL(new Blob([aggregateCsv(data.period,[...data.overview,...data.demand,...data.service,...(financial && !amounts.loading && !amounts.error ? money : [])])],{type:"text/csv;charset=utf-8"}));
    const link = document.createElement("a");
    link.href=url; link.download=`moovu-aggregate-${data.period.from}-${data.period.to}.csv`; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <main className="min-w-0 space-y-6">
    <PageHeader kicker="Workspace" title="Business Intelligence" description="Recorded business activity and financial evidence." />
    <form className="moovu-card flex flex-wrap items-end gap-3 p-4" onSubmit={event=>{
      event.preventDefault();
      try { setSelection(biPeriod(new URLSearchParams({preset,...dates}))); setFormError(null); }
      catch(error) { setFormError(error instanceof Error ? error.message : "Invalid reporting period."); }
    }}>
      <label className="grid gap-1">Reporting period<select className="moovu-input" value={preset} onChange={e=>setPreset(e.target.value)}>
        {Object.entries({today:"Today",seven:"Last seven calendar days",thirty:"Last 30 calendar days",month:"Current month",previousMonth:"Previous month",custom:"Custom"}).map(([id,label])=><option key={id} value={id}>{label}</option>)}
      </select></label>
      {preset==="custom" && (["from","to"] as const).map(field=><label key={field} className="grid gap-1">{field==="from"?"Start date":"End date"}<input className="moovu-input" type="date" required value={dates[field]} onChange={e=>setDates({...dates,[field]:e.target.value})} /></label>)}
      <button type="submit" className="moovu-btn moovu-btn-primary">Apply period</button>
      <button type="button" className="moovu-btn moovu-btn-secondary" disabled={!data||ops.loading||Boolean(ops.error)} onClick={exportSummary}>Export aggregate CSV</button>
      {formError && <p role="alert">{formError}</p>}
    </form>
    <p>{selection.from} to {selection.to} · Africa/Johannesburg{selection.partial && " · includes the current partial day"}</p>
    {ops.loading && <p role="status">Loading operational intelligence…</p>}
    {ops.error && <p role="alert">{ops.error} <button className="underline" onClick={ops.retry}>Retry operational summary</button></p>}
    {data&&!ops.error&&<>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Business overview</h2>
        <p>Bookings count persisted trip records by creation. Completions and cancellations use their recorded event dates. Cohort outcomes reflect status at {data.period.observation}.</p>
        <p>{data.period.partial ? "Comparisons are unavailable for partial current days." : `Comparison: ${data.period.previous.from} to ${data.period.previous.to}. Cohort maturity is not compared.`}</p>
        <Cards metrics={data.overview} />
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Demand and customer activity</h2>
        <Cards metrics={data.demand} />
        {data.coverage.bookings && Math.max(...data.series.hours)>0 && <p>Peak recorded booking hour: {String(data.series.hours.indexOf(Math.max(...data.series.hours))).padStart(2,"0")}:00 Johannesburg time.</p>}
        <p>Repeat usage measures identified riders with at least two completed trips in the selected period. Identity gaps suppress that rate.</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <Series title="Daily recorded bookings" rows={data.coverage.bookings ? data.series.days.map(row=>[row.date,row.bookings]) : null} />
          <Series title="Bookings by Johannesburg hour" rows={data.coverage.bookings ? data.series.hours.map((value,hour)=>[`${String(hour).padStart(2,"0")}:00`,value]) : null} />
          <Series title="Bookings by weekday" rows={data.coverage.bookings ? data.series.weekdays.map((value,index)=>[["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][index],value]) : null} />
          <Series title="Booking demand by category" rows={data.coverage.bookings ? Object.entries(data.series.categories) : null} />
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Service delivery and driver performance</h2>
        <p>Offer acceptance uses recorded offers issued in the selected window, including unresolved outcomes. Timing covers valid recorded intervals only. Historical offer coverage is unproven.</p>
        <Cards metrics={data.service} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Series title="Daily completions" rows={data.coverage.completions ? data.series.days.map(row=>[row.date,row.completed]) : null} />
          <Series title="Daily cancellations" rows={data.coverage.cancellations ? data.series.days.map(row=>[row.date,row.cancelled]) : null} />
          <Series title="Daily completing drivers" rows={data.coverage.completions ? data.series.days.map(row=>[row.date,row.drivers]) : null} />
          <Series title="Completed trips by category" rows={data.coverage.completions ? Object.entries(data.series.completedCategories) : null} />
          <Series title="Recorded payment method" rows={data.coverage.completions ? Object.entries(data.series.methods) : null} />
          <Series title="Recorded cancellation reasons" rows={data.reasons} />
          <Series title="Recorded cancellation actors" rows={data.actors} />
        </div>
      </section>
    </>}
    {financial && <section className="space-y-3">
      <h2 className="text-xl font-semibold">Financial intelligence</h2>
      <p>Completed fares are recorded ride value. Accrued commission, collections, outstanding debt and verified customer receipts are separate measures.</p>
      {amounts.loading && <p role="status">Loading financial intelligence…</p>}
      {amounts.error && <p role="alert">{amounts.error} <button className="underline" onClick={amounts.retry}>Retry financial summary</button></p>}
      {financialData && !amounts.error && <Cards metrics={money} />}
      <a className="underline" href="/admin/reports">Open financial reports for cancellation assessments and compensation</a>
    </section>}
  </main>;
}
