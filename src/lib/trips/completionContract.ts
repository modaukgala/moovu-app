export const END_OTP_BYPASS_REASONS = [
  "Customer phone unavailable/dead",
  "Customer unable to access OTP",
  "Connectivity issue",
  "Customer left vehicle",
  "Other",
] as const;

export type CompletionMode = "otp" | "bypass" | "admin";

const COMMON_COMPLETION_COLUMNS = [
  "id",
  "completed_at",
  "completed_by",
  "final_fare",
  "estimated_fare",
  "fare_adjustment_amount",
  "fare_adjustment_reason",
  "fare_finalized_at",
  "actual_distance_km",
  "actual_duration_min",
  "actual_route_source",
] as const;

const ADMIN_COMPLETION_COLUMNS = [
  "admin_completion_reason",
  "admin_completion_note",
] as const;

const DRIVER_BYPASS_COLUMNS = [
  "completed_without_end_otp",
  "end_otp_bypass_reason",
  "end_otp_bypass_note",
  "end_otp_bypassed_by",
  "end_otp_bypassed_at",
] as const;

export function completionSchemaSelect(mode: Exclude<CompletionMode, "otp">) {
  const modeColumns =
    mode === "admin" ? ADMIN_COMPLETION_COLUMNS : DRIVER_BYPASS_COLUMNS;
  return [...COMMON_COMPLETION_COLUMNS, ...modeColumns].join(",");
}

export function buildCompletionAuditFields(params: {
  mode: CompletionMode;
  actorId: string;
  now: string;
  note?: string;
  reason?: string;
}) {
  const note = String(params.note ?? "").trim();

  if (params.mode === "admin") {
    return {
      completed_by: "admin",
      end_otp_verified: false,
      admin_completion_reason: "Admin override",
      admin_completion_note: note,
    };
  }

  if (params.mode === "bypass") {
    return {
      completed_by: "driver",
      end_otp_verified: false,
      completed_without_end_otp: true,
      end_otp_bypass_reason: params.reason ?? null,
      end_otp_bypass_note: note || null,
      end_otp_bypassed_by: params.actorId,
      end_otp_bypassed_at: params.now,
    };
  }

  return {
    completed_by: "driver",
    end_otp_verified: true,
  };
}

export function missingCompletionColumn(
  error: { code?: string; message?: string } | null | undefined,
) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    error?.code === "42703" ||
    error?.code === "PGRST204" ||
    message.includes("schema cache") ||
    message.includes("could not find") && message.includes("column") ||
    message.includes("column") && message.includes("does not exist")
  );
}

export function completionSchemaErrorMessage(
  mode: Exclude<CompletionMode, "otp">,
) {
  return mode === "admin"
    ? "Admin trip completion is not fully configured. Apply docs/admin-trip-completion-migration.sql, then retry."
    : "End OTP bypass is not fully configured. Apply docs/admin-trip-completion-migration.sql, then retry.";
}
