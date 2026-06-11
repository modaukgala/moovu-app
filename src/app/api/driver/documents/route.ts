import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Server error.";
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing access token." }, { status: 401 });
    }

    const supabaseUser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
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
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: mapping, error: mappingError } = await supabaseAdmin
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mappingError) {
      return NextResponse.json({ ok: false, error: mappingError.message }, { status: 500 });
    }

    if (!mapping?.driver_id) {
      return NextResponse.json({ ok: false, error: "Driver account is not linked yet." }, { status: 400 });
    }

    let { data, error } = await supabaseAdmin
      .from("driver_documents")
      .select("id,doc_type,document_type,file_path,status,review_status,rejection_reason,uploaded_at,expires_on")
      .eq("driver_id", mapping.driver_id)
      .order("uploaded_at", { ascending: false });

    if (error?.code === "42703") {
      const legacy = await supabaseAdmin
        .from("driver_documents")
        .select("id,doc_type,file_path,status,review_status,uploaded_at,expires_on")
        .eq("driver_id", mapping.driver_id)
        .order("uploaded_at", { ascending: false });
      data = (legacy.data ?? []).map((row) => ({
        ...row,
        document_type: row.doc_type,
        rejection_reason: null,
      }));
      error = legacy.error;
    }

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, documents: data ?? [] });
  } catch (error: unknown) {
    return NextResponse.json({ ok: false, error: errorMessage(error) }, { status: 500 });
  }
}
