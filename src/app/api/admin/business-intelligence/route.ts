import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { biPeriod, change, customerActivity, latency, metric, offerEvidence, tripSeries, uniqueRows, type Offer, type Profile, type Trip } from "@/lib/admin/businessIntelligence";
import { chunkValues, collectBoundedPages } from "@/lib/admin/boundedRetrieval";

const projections = "id,created_at,completed_at,cancelled_at,status,customer_id,customer_auth_user_id,driver_id,ride_option,payment_method,actual_distance_km,actual_duration_min,cancelled_by,cancellation_reason";
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers:{ "Cache-Control":"private, no-store" } });

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) return response({ ok:false,error:auth.error },auth.status);
    let period: ReturnType<typeof biPeriod>;
    try { period = biPeriod(new URL(req.url).searchParams); }
    catch (error) { return response({ok:false,error:error instanceof Error ? error.message : "Invalid dates."},400); }
    const db = auth.supabaseAdmin;
    const cutoff = new Date(Math.min(Date.parse(period.observation), Date.parse(period.end))).toISOString();
    async function trips(field: "created_at"|"completed_at"|"cancelled_at", status?: string, previous = false) {
      const dates = previous ? period.previous : period;
      let total: number | null = null;
      try {
        const result = await collectBoundedPages<Trip>({ pageSize:500,maxRows:10000,load:async (from,to)=>{
          let query = db.from("trips").select(projections,{count:"exact"}).gte(field,dates.start).lt(field,previous ? dates.end : cutoff);
          if (status) query = query.eq("status",status);
          const read = await query.order(field).order("id").range(from,to);
          if (read.error || !read.data || read.count == null) throw new Error("Trip evidence unavailable");
          if (total !== null && total !== read.count) throw new Error("Trip cohort changed while reading");
          total = read.count;
          return read.data;
        }});
        const rows = uniqueRows(result.rows);
        return { total, rows, complete:result.complete && rows.length === total && result.rows.length === rows.length };
      } catch { return { total,rows:[] as Trip[],complete:false }; }
    }
    const [booked,completed,cancelled] = await Promise.all([trips("created_at"),trips("completed_at","completed"),trips("cancelled_at","cancelled")]);
    const previous = period.partial ? null : await Promise.all([trips("created_at",undefined,true),trips("completed_at","completed",true),trips("cancelled_at","cancelled",true)]);
    const summaries = [booked,completed,cancelled];
    const overview = ["Recorded bookings","Completed trips","Recorded cancellations"].flatMap((label,i)=>[
      metric(label,summaries[i].total),
      metric(label+" change", change(summaries[i].total,previous?.[i].total ?? null, Boolean(previous?.[i].complete && summaries[i].complete)), "%"),
    ]);
    const drivers = new Set(completed.rows.flatMap(row=>row.driver_id ? [row.driver_id] : []));
    const assigned = completed.rows.filter(row=>row.driver_id).length;
    const customerRead = async () => {
      if (!completed.complete) return null;
      const profiles: Profile[] = [];
      const ids = [...new Set(completed.rows.flatMap(row=>row.customer_id ? [row.customer_id] : []))];
      for (const batch of chunkValues(ids,200)) {
        const {data,error} = await db.from("customers").select("id,auth_user_id").in("id",batch);
        if (error || !data) return null;
        profiles.push(...data);
      }
      return customerActivity(completed.rows,profiles,true);
    };
    const offerRead = async () => {
      let total: number | null = null;
      const offers = await collectBoundedPages<Offer>({pageSize:500,maxRows:5000, load:async(from,to)=>{
        const {data,error,count} = await db.from("driver_trip_offers").select("id,trip_id,status,offered_at,responded_at",{count:"exact"})
          .gte("offered_at",period.start).lt("offered_at",cutoff).order("offered_at").order("id").range(from,to);
        if (error || !data || count == null || (total !== null && total !== count)) throw new Error("Offer evidence unavailable.");
        total = count;
        return data;
      }});
      if (!offers.complete || total !== offers.rows.length || uniqueRows(offers.rows).length !== offers.rows.length) return null;
      const ids = [...new Set(offers.rows.map(row=>row.trip_id))];
      const requested = new Map<string,string>();
      for (const batch of chunkValues(ids,200)) {
        const {data,error} = await db.from("trips").select("id,created_at").in("id",batch);
        if (error || !data) break;
        for (const row of data) if (row.created_at) requested.set(row.id,row.created_at);
      }
      return offerEvidence(offers.rows,requested,period.observation);
    };
    const [customers,offers] = await Promise.all([customerRead().catch(()=>null),offerRead().catch(()=>null)]);
    const evidence = (value:number|null,label:string,unit = "count",denominator?:number)=>metric(label,value,unit,denominator,value === null ? "Unavailable" : "Recorded evidence");
    const demand = [
      evidence(customers?.identified ?? null,"Identified customers completing rides","count",completed.total ?? undefined),
      evidence(customers?.matched ?? null,"Completed rides with identified customer","count",completed.total ?? undefined),
      evidence(customers?.unresolved ?? null,"Unresolved customer links"),
      evidence(customers?.conflicts ?? null,"Conflicting customer links"),
      evidence(customers?.repeat ?? null,"Within-period repeat usage","%",customers?.identified),
    ];
    const service = [
      evidence(completed.complete ? drivers.size : null,"Distinct completing drivers"),
      evidence(completed.complete ? assigned : null,"Assigned completed trips"),
      evidence(completed.complete ? completed.rows.length-assigned : null,"Completed trips without driver"),
      evidence(completed.complete && drivers.size ? assigned/drivers.size : null,"Completed trips per completing driver","trips/driver",drivers.size),
      evidence(offers?.issued ? offers.issued : null,"Recorded offers issued"),
      ...Object.entries(offers?.outcomes ?? {accepted:null,declined:null,expired:null,unresolved:null}).map(([label,value])=>evidence(offers?.issued ? value : null,"Recorded offers "+label,"count",offers?.issued)),
      evidence(offers?.issued ? offers.outcomes.accepted*100/offers.issued : null,"Acceptance share of recorded offers issued","%",offers?.issued),
      evidence(offers?.first.average ?? null,"Mean time to first recorded offer","min",offers?.first.usable),
      evidence(offers?.accepted.average ?? null,"Mean time to recorded acceptance","min",offers?.accepted.usable),
    ];
    for (const [key,label,unit] of [["actual_distance_km","Recorded distance","km"],["actual_duration_min","Recorded duration","min"]] as const) {
      const values = completed.rows.flatMap(row=>typeof row[key]==="number" && Number.isFinite(row[key]) && row[key]>=0 ? [row[key]] : []);
      service.push(evidence(completed.complete && values.length ? values.reduce((a,b)=>a+b,0)/values.length : null,"Mean "+label.toLowerCase(),unit,values.length));
    }
    const reasons = new Map<string,number>();
    const actors = new Map<string,number>();
    for (const row of cancelled.rows) {
      const known = ["Driver unavailable","No driver available","Changed mind","Booked by mistake","Too expensive","Other"];
      const reason = !row.cancellation_reason?.trim() ? "Unknown" : known.includes(row.cancellation_reason) ? row.cancellation_reason : "Other recorded reason";
      const actor = ["customer","driver","admin","system"].includes(row.cancelled_by ?? "") ? row.cancelled_by! : "Unknown";
      reasons.set(reason,(reasons.get(reason) ?? 0)+1); actors.set(actor,(actors.get(actor) ?? 0)+1);
    }
    const elapsed = latency(cancelled.rows.map(row=>Date.parse(row.cancelled_at ?? "")-Date.parse(row.created_at ?? "")));
    service.push(evidence(cancelled.complete ? elapsed.average : null,"Mean time from booking to cancellation","min",elapsed.usable));
    const cohort = { completed:0,cancelled:0,unresolved:0,unknown:0 };
    for (const row of booked.rows) {
      if (row.status === "completed" || row.status === "cancelled") cohort[row.status]++;
      else if (["requested","scheduled","offered","assigned","arrived","ongoing"].includes(row.status)) cohort.unresolved++;
      else cohort.unknown++;
    }
    for (const [key,value] of Object.entries(cohort)) overview.push(evidence(booked.complete ? value : null,"Booking cohort at observation: "+key,"count",booked.total ?? undefined));
    const terminalEvents = completed.total != null && cancelled.total != null ? completed.total + cancelled.total : 0;
    overview.push(evidence(terminalEvents && cancelled.total != null ? cancelled.total*100/terminalEvents : null,
      "Terminal-event cancellation share","%",terminalEvents || undefined));
    const terminal = booked.complete ? booked.rows.length : 0;
    overview.push(evidence(terminal ? cohort.completed*100/terminal : null,"Recorded booking cohort completion share","%",terminal || undefined));
    const series = tripSeries(booked.rows,completed.rows,cancelled.rows,period);
    return response({ok:true,period,overview,demand,service,series,
      coverage:{bookings:booked.complete,completions:completed.complete,cancellations:cancelled.complete,offers:offers !== null && offers.issued > 0},
      reasons:cancelled.complete ? [...reasons] : null, actors:cancelled.complete ? [...actors] : null});
  } catch {
    return response({ok:false,error:"Business intelligence is unavailable. Please retry."},503);
  }
}
