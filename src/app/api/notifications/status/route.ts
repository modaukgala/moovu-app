import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isPushRole, verifyPushRoleAccess } from "@/lib/push-auth";

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!accessToken) {
      return NextResponse.json({ ok: false, error: "Missing access token." }, { status: 401 });
    }

    const url = new URL(req.url);
    const role = url.searchParams.get("role") || "";
    if (!isPushRole(role)) {
      return NextResponse.json({ ok: false, error: "Invalid role." }, { status: 400 });
    }

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${accessToken}` } } },
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );

    const roleAccess = await verifyPushRoleAccess(supabaseAdmin, user.id, role);
    if (!roleAccess.ok) {
      return NextResponse.json({ ok: false, error: roleAccess.error }, { status: roleAccess.status });
    }

    const { data, error } = await supabaseAdmin
      .from("fcm_tokens")
      .select("id,role,token,platform,device_id,app_source,is_active,last_used_at,updated_at")
      .eq("user_id", user.id)
      .eq("role", role)
      .order("updated_at", { ascending: false })
      .limit(10);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const tokens = (data ?? []).map((row) => {
      const token = String(row.token ?? "");
      return {
        ...row,
        token: token ? `...${token.slice(-12)}` : "",
      };
    });

    return NextResponse.json({
      ok: true,
      userId: user.id,
      activeTokenCount: tokens.filter((row) => row.is_active).length,
      tokens,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Notification status failed." },
      { status: 500 },
    );
  }
}
