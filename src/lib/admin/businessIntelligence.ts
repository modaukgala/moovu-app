import { earningsPeriod, paymentClass, recordedSum, reportingDay } from "./earningsMetrics";

const DAY = 86_400_000;
export const BI_MAX_DAYS = 31;
export type Trip = {
  id: string; created_at: string | null; completed_at: string | null; cancelled_at: string | null;
  status: string; customer_id: string | null; customer_auth_user_id: string | null; driver_id: string | null;
  ride_option: string | null; payment_method: string | null; actual_distance_km: number | null; actual_duration_min: number | null;
  cancelled_by: string | null; cancellation_reason: string | null;
};
export type Offer = { id: string; trip_id: string; status: string; offered_at: string; responded_at: string | null };
export type Profile = { id: string; auth_user_id: string | null };
export type Metric = { label: string; value: number | null; unit: string; denominator?: number; coverage: string };
export function metric(label: string, value: number | null, unit = "count", denominator?: number, coverage = value === null ? "Unavailable" : "Recorded") {
  return { label, value, unit, denominator, coverage };
}

export function biPeriod(params: URLSearchParams, now = new Date()) {
  const today = reportingDay(now);
  const date = (offset: number) => reportingDay(new Date(now.getTime() + offset * DAY));
  const monthStart = today.slice(0, 7) + "-01";
  const previousMonthEnd = new Date(Date.parse(monthStart + "T00:00:00+02:00") - DAY);
  const choices: Record<string, [string, string]> = {
    today: [today,today], seven: [date(-6),today], thirty: [date(-29),today], month: [monthStart,today],
    previousMonth: [reportingDay(previousMonthEnd).slice(0,7)+"-01",reportingDay(previousMonthEnd)],
    custom: [params.get("from") ?? "",params.get("to") ?? ""],
  };
  const preset = params.get("preset") ?? "thirty";
  if (!Object.hasOwn(choices, preset)) throw new Error("Invalid reporting preset.");
  const [from,to] = choices[preset];
  const period = earningsPeriod(new URLSearchParams({ from,to }),now);
  const start = Date.parse(period.start), end = Date.parse(period.end);
  const days = (end-start)/DAY;
  if (days > BI_MAX_DAYS || to > today) throw new Error("Choose up to 31 calendar days ending today or earlier.");
  return { ...period, days, partial: to === today, observation: now.toISOString(), timezone: "Africa/Johannesburg",
    previous: { start: new Date(start - days*DAY).toISOString(), end: period.start,
      from: reportingDay(new Date(start-days*DAY)), to: reportingDay(new Date(start-DAY)) } };
}
export type BIPeriod = ReturnType<typeof biPeriod>;

export function change(current: number | null, previous: number | null, comparable: boolean) {
  return comparable && current !== null && previous !== null && previous > 0 ? (current-previous)*100/previous : null;
}

export function uniqueRows<T extends { id: string }>(rows: T[]) {
  return [...new Map(rows.map(row => [row.id,row])).values()];
}

export function executiveMoney(rows: { id: string; fare_amount?: unknown; commission_amount?: unknown }[], count: number | null) {
  const complete = count !== null && count === rows.length && uniqueRows(rows).length === rows.length;
  const read = (field: "fare_amount" | "commission_amount") => complete
    ? recordedSum(rows.map(row => {
      const value = row[field];
      return typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : null;
    })) : null;
  const gross = read("fare_amount");
  return { gross, commission: read("commission_amount"), average: gross !== null && count ? gross/count : null };
}

export function customerActivity(rows: Trip[], profiles: Profile[], complete: boolean) {
  const counts = new Map<string, number>();
  const byId = new Map(profiles.map(row => [row.id,row]));
  let matched = 0, conflicts = 0;
  for (const trip of uniqueRows(rows)) {
    const profile = trip.customer_id ? byId.get(trip.customer_id) : undefined;
    if (profile?.auth_user_id && trip.customer_auth_user_id && profile.auth_user_id !== trip.customer_auth_user_id) {
      conflicts++;
      continue;
    }
    const auth = profile?.auth_user_id ?? trip.customer_auth_user_id;
    const key = auth ? "auth:"+auth : profile ? "profile:"+profile.id : null;
    if (!key) continue;
    counts.set(key,(counts.get(key) ?? 0)+1);
    matched++;
  }
  const denominator = uniqueRows(rows).length;
  return { identified: counts.size, matched, conflicts, unresolved: denominator-matched-conflicts,
    repeat: complete && matched === denominator && counts.size ? [...counts.values()].filter(n=>n>=2).length*100/counts.size : null };
}

export function latency(values: number[]) {
  const usable = values.filter(n => Number.isFinite(n) && n >= 0);
  return { average: usable.length ? usable.reduce((a,b)=>a+b,0)/usable.length/60_000 : null, usable: usable.length };
}

export function offerEvidence(offers: Offer[], requests: Map<string,string>, cutoff: string) {
  const rows = uniqueRows(offers);
  const outcomes = { accepted:0, declined:0, expired:0, unresolved:0 };
  const first = new Map<string, number>();
  const accepted = new Map<string, number>();
  for (const row of rows) {
    const issue = Date.parse(row.offered_at);
    const request = Date.parse(requests.get(row.trip_id) ?? "");
    const response = Date.parse(row.responded_at ?? "");
    const outcome = row.status === "rejected" ? "declined" : row.status;
    if (outcome === "accepted" || outcome === "declined" || outcome === "expired") outcomes[outcome]++;
    else outcomes.unresolved++;
    if (issue >= request && issue <= Date.parse(cutoff)) first.set(row.trip_id,Math.min(first.get(row.trip_id) ?? Infinity, issue-request));
    if (outcome === "accepted" && response >= issue && issue >= request && response <= Date.parse(cutoff)) {
      accepted.set(row.trip_id,Math.min(accepted.get(row.trip_id) ?? Infinity,response-request));
    }
  }
  return { outcomes, first: latency([...first.values()]), accepted: latency([...accepted.values()]), issued: rows.length };
}

export function tripSeries(booked: Trip[], completed: Trip[], cancelled: Trip[], period: BIPeriod) {
  const days = Object.fromEntries(Array.from({length:period.days},(_,i)=>[reportingDay(new Date(Date.parse(period.start)+i*DAY)),{ bookings:0,completed:0,cancelled:0,drivers:new Set<string>() }]));
  const hours = Array.from({ length:24 },()=>0), weekdays = Array.from({length:7},()=>0);
  const categories = { Go:0,"Go XL":0,Unknown:0 };
  const completedCategories = { Go:0,"Go XL":0,Unknown:0 };
  const methods = { cash:0,transfer:0,online:0,unknown:0 };
  const category = (option: string | null) => option==="go" ? "Go" : option==="group" ? "Go XL" : "Unknown";
  for (const row of booked) {
    const instant = Date.parse(row.created_at ?? "");
    if (!Number.isFinite(instant)) continue;
    const day = days[reportingDay(new Date(instant))];
    if (!day) continue;
    const local = new Date(instant+7_200_000);
    day.bookings++; hours[local.getUTCHours()]++; weekdays[local.getUTCDay()]++;
    categories[category(row.ride_option)]++;
  }
  for (const row of completed) {
    const instant = Date.parse(row.completed_at ?? "");
    const day = Number.isFinite(instant) ? days[reportingDay(new Date(instant))] : undefined;
    if (day) { day.completed++; if(row.driver_id) day.drivers.add(row.driver_id); }
    completedCategories[category(row.ride_option)]++;
    methods[paymentClass(row.payment_method)]++;
  }
  for (const row of cancelled) {
    const instant = Date.parse(row.cancelled_at ?? "");
    const day = Number.isFinite(instant) ? days[reportingDay(new Date(instant))] : undefined;
    if (day) day.cancelled++;
  }
  return { days: Object.entries(days).map(([date,row])=>({ date, bookings:row.bookings,completed:row.completed,cancelled:row.cancelled,drivers:row.drivers.size })),
    hours, weekdays, categories, completedCategories, methods };
}

function csvField(value: string | number | undefined) {
  const raw = String(value ?? "");
  const safe = typeof value === "string" && /^(?:[\t\r\n]|[\s\uFEFF]*[=+\-@＝＋－＠])/.test(raw) ? "'"+raw : raw;
  return '"'+safe.replaceAll('"','""')+'"';
}
export function aggregateCsv(period: BIPeriod, metrics: Metric[]) {
  return [
    ["Start date","End date","Timezone","Observed at","Metric","Value","Unit","Denominator","Coverage","Comparison start","Comparison end"],
    ...metrics.map(m=>[period.from,period.to,period.timezone,period.observation,m.label,m.value ?? "Unavailable",m.unit,m.denominator,m.coverage,
      m.unit === "%" && m.label.endsWith("change") ? period.previous.from : undefined,
      m.unit === "%" && m.label.endsWith("change") ? period.previous.to : undefined]),
  ].map(row=>row.map(csvField).join(",")).join("\r\n");
}
