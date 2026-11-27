import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

type Row = { id: string; first_name: string | null; last_name: string | null; phone: string | null; email: string | null; created_at: string | null; status: string | null };

const key = (row: Row) => `${(row.first_name ?? "").trim().toLowerCase()}|${(row.last_name ?? "").trim().toLowerCase()}`;

/**
 * Possible duplicate customers: accounts with the same first name and surname.
 * (Phone numbers and emails are already unique, so same-name is the remaining signal.)
 * Admin decides whether they are really the same person.
 */
export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const db = auth.supabaseAdmin;
  const rows: Row[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await db.from("customers").select("id,first_name,last_name,phone,email,created_at,status")
      .order("id").range(from, from + 999);
    if (error) return NextResponse.json({ ok: false, error: "Customers are unavailable." }, { status: 503 });
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) break;
  }
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    if (!row.first_name?.trim() || !row.last_name?.trim() || /^deleted$/i.test(row.first_name.trim())) continue;
    const list = groups.get(key(row)) ?? [];
    list.push(row);
    groups.set(key(row), list);
  }
  const dupes = [...groups.values()].filter(list => list.length > 1);
  const ids = dupes.flat().map(r => r.id);
  const tripCounts = new Map<string, { total: number; completed: number; last: string | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("trips").select("customer_id,status,created_at").in("customer_id", ids.slice(i, i + 200)).limit(5000);
    for (const trip of data ?? []) {
      const c = tripCounts.get(trip.customer_id) ?? { total: 0, completed: 0, last: null };
      c.total += 1;
      if (trip.status === "completed") c.completed += 1;
      if (!c.last || String(trip.created_at) > c.last) c.last = trip.created_at;
      tripCounts.set(trip.customer_id, c);
    }
  }
  const result = dupes.map(list => ({
    name: `${list[0].first_name?.trim()} ${list[0].last_name?.trim()}`,
    customers: list.map(r => ({ ...r, trips: tripCounts.get(r.id) ?? { total: 0, completed: 0, last: null } }))
      .sort((a, b) => b.trips.total - a.trips.total),
  })).sort((a, b) => b.customers.length - a.customers.length || a.name.localeCompare(b.name));
  return NextResponse.json({ ok: true, totalCustomers: rows.length, groups: result }, { headers: { "Cache-Control": "private, no-store" } });
}
