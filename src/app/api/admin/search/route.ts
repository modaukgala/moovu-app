import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";
import { adminDriverName, adminPersonName } from "@/lib/admin/identity";

/** Strip characters that would break a PostgREST or() filter. */
function term(raw: string) {
  return raw.replace(/[%,()*\\]/g, " ").trim().slice(0, 60);
}

/** One search box for customers, drivers and trips (name, phone, or trip ID). Read-only. */
export async function GET(req: Request) {
  const auth = await requireAdminUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const q = term(new URL(req.url).searchParams.get("q") ?? "");
  if (q.length < 2) return NextResponse.json({ ok: true, customers: [], drivers: [], trips: [] });
  const db = auth.supabaseAdmin;
  const like = `%${q}%`;
  const words = q.split(/\s+/).filter(Boolean);
  const nameFilter = words.length > 1
    ? `and(first_name.ilike.%${words[0]}%,last_name.ilike.%${words.slice(1).join(" ")}%)`
    : `first_name.ilike.${like},last_name.ilike.${like}`;
  const isUuid = /^[0-9a-f-]{8,36}$/i.test(q);

  const [customers, drivers, trips] = await Promise.all([
    db.from("customers").select("id,first_name,last_name,phone,email")
      .or(`${nameFilter},phone.ilike.${like},email.ilike.${like}`).limit(6),
    db.from("drivers").select("id,first_name,last_name,phone,status,online")
      .or(`${nameFilter},phone.ilike.${like}`).limit(6),
    isUuid && q.length === 36
      ? db.from("trips").select("id,rider_name,pickup_address,dropoff_address,status,created_at").eq("id", q).limit(1)
      : db.from("trips").select("id,rider_name,pickup_address,dropoff_address,status,created_at")
          .or(`rider_name.ilike.${like},rider_phone.ilike.${like},pickup_address.ilike.${like},dropoff_address.ilike.${like}`)
          .order("created_at", { ascending: false }).limit(6),
  ]);

  return NextResponse.json({
    ok: true,
    customers: (customers.data ?? []).map(c => ({ id: c.id, name: adminPersonName(c, "Customer"), phone: c.phone, email: c.email })),
    drivers: (drivers.data ?? []).map(d => ({ id: d.id, name: adminDriverName(d), phone: d.phone, status: d.status, online: d.online })),
    trips: trips.data ?? [],
  }, { headers: { "Cache-Control": "private, no-store" } });
}
