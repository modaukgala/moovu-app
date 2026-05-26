import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/auth/admin";

type NotificationLogRow = {
  id: string;
  user_id: string | null;
  role: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  delivery_status: string | null;
  error_message: string | null;
  created_at: string | null;
};

const ALLOWED_STATUSES = new Set(["queued", "sent", "failed", "no_tokens"]);
const ALLOWED_ROLES = new Set(["customer", "driver", "admin"]);

function isMissingNotificationsTable(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("app_notifications") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
}

function safeLimit(value: string | null) {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(Math.floor(parsed), 1), 100);
}

export async function GET(req: Request) {
  try {
    const auth = await requireAdminUser(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const role = url.searchParams.get("role");
    const limit = safeLimit(url.searchParams.get("limit"));

    let query = auth.supabaseAdmin
      .from("app_notifications")
      .select("id,user_id,role,title,body,url,delivery_status,error_message,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status && status !== "all" && ALLOWED_STATUSES.has(status)) {
      query = query.eq("delivery_status", status);
    }

    if (role && role !== "all" && ALLOWED_ROLES.has(role)) {
      query = query.eq("role", role);
    }

    const { data, error } = await query;

    if (error) {
      if (isMissingNotificationsTable(error)) {
        return NextResponse.json({
          ok: true,
          logs: [],
          warning: "Notification history is not ready. Run docs/notification-polish-migration.sql on staging, then production.",
        });
      }

      console.error("[admin-notification-logs] failed to load notification logs", {
        reason: error.message,
      });
      return NextResponse.json(
        { ok: false, error: "Could not load notification logs. Please refresh or contact admin support." },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as NotificationLogRow[];
    return NextResponse.json({
      ok: true,
      logs: rows,
      summary: {
        total: rows.length,
        failed: rows.filter((row) => row.delivery_status === "failed").length,
        noTokens: rows.filter((row) => row.delivery_status === "no_tokens").length,
        sent: rows.filter((row) => row.delivery_status === "sent").length,
      },
    });
  } catch (error: unknown) {
    console.error("[admin-notification-logs] unexpected error", error);
    return NextResponse.json(
      { ok: false, error: "Could not load notification logs. Please refresh or contact admin support." },
      { status: 500 },
    );
  }
}
