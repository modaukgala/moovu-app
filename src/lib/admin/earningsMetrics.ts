export function reportingDay(date: Date) {
  return new Date(date.getTime() + 7200000).toISOString().slice(0, 10);
}

export function earningsPeriod(params: URLSearchParams, now = new Date()) {
  const from = params.get("from") ?? reportingDay(new Date(now.getTime() - 7 * 86400000));
  const to = params.get("to") ?? reportingDay(now);
  const parse = (day: string) => {
    const time = Date.parse(day + "T00:00:00+02:00");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(time) || reportingDay(new Date(time)) !== day) throw new Error("Invalid reporting date.");
    return time;
  };
  const start = parse(from);
  const end = parse(to);
  if (end < start) throw new Error("Choose an end date on or after the start date.");
  return { from, to, start: new Date(start).toISOString(), end: new Date(end + 86400000).toISOString() };
}

export function paymentClass(method: string | null) {
  switch (method?.trim().toLowerCase()) {
    case "cash": return "cash";
    case "bank_transfer": case "transfer": case "eft": return "transfer";
    case "online": return "online";
    default: return "unknown";
  }
}

export type EarningsTrip = {
  id: string; driver_id: string | null; completed_at: string; payment_method: string | null;
  fare_amount: number | null; commission_pct: number | null; commission_amount: number | null; driver_net_earnings: number | null;
};

export function recordedSum(values: (number | null)[]) {
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) return null;
  return values.reduce<number>((total, value) => total + Math.round(value! * 100), 0) / 100;
}

export function summariseTrips(rows: EarningsTrip[]) {
  return {
    count: rows.length,
    gross: recordedSum(rows.map((row) => row.fare_amount)),
    commission: recordedSum(rows.map((row) => row.commission_amount)),
    net: recordedSum(rows.map((row) => row.driver_net_earnings)),
    methods: Object.fromEntries((["cash","transfer","online","unknown"] as const).map((method) => {
      const matches = rows.filter((row) => paymentClass(row.payment_method) === method);
      return [method, { count: matches.length, gross: recordedSum(matches.map((row) => row.fare_amount)) }];
    })),
  };
}
