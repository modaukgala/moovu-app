import { randomBytes } from "crypto";
import type { PushRole } from "@/lib/push-auth";

type NativeActionType = "trip_offer" | "chat_reply";
type SupabaseInsertResult = PromiseLike<{
  error: { message?: string; code?: string } | null;
}>;

type NativeActionTokenParams = {
  userId: string;
  role: PushRole;
  actionType: NativeActionType;
  tripId: string;
  expiresInSeconds?: number;
  metadata?: Record<string, string | number | boolean | null>;
  supabase: {
    from: (table: "notification_action_tokens") => {
      insert: (value: Record<string, unknown>) => SupabaseInsertResult;
    };
  };
};

function isMissingTableError(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() || "";
  return (
    error?.code === "PGRST205" ||
    message.includes("notification_action_tokens") ||
    (message.includes("relation") && message.includes("does not exist")) ||
    message.includes("could not find the table")
  );
}

export async function createNativeNotificationActionToken({
  userId,
  role,
  actionType,
  tripId,
  expiresInSeconds = 10 * 60,
  metadata = {},
  supabase,
}: NativeActionTokenParams) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000).toISOString();

  const { error } = await supabase.from("notification_action_tokens").insert({
    token,
    user_id: userId,
    role,
    action_type: actionType,
    trip_id: tripId,
    metadata,
    expires_at: expiresAt,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  });

  if (error) {
    if (isMissingTableError(error)) {
      console.error("[native-actions] notification_action_tokens table missing. Run docs/native-notification-actions-migration.sql.");
      return null;
    }

    console.error("[native-actions] failed to create action token", {
      userId,
      role,
      actionType,
      tripId,
      reason: error.message,
    });
    return null;
  }

  return token;
}
