import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { chatPreview, normalizeTripMessageBody } from "@/lib/trip-chat";
import { notifyCustomerForTrip, notifyDriverForTrip } from "@/lib/push-notify";
import { respondToOffer as respondToAtomicOffer } from "@/lib/dispatch/respondToOffer";

type NativeActionRow = {
  id: string;
  token: string;
  user_id: string;
  role: "customer" | "driver" | "admin";
  action_type: "trip_offer" | "chat_reply";
  trip_id: string;
  expires_at: string;
  used_at: string | null;
};

const CHAT_SENDABLE_STATUSES = new Set(["assigned", "arrived", "ongoing"]);

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function consumeActionToken(token: string): Promise<
  | { ok: true; row: NativeActionRow }
  | { ok: false; status: number; error: string }
> {
  const { data: row, error } = await supabaseAdmin
    .from("notification_action_tokens")
    .select("id,token,user_id,role,action_type,trip_id,expires_at,used_at")
    .eq("token", token)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: error.message };
  if (!row) return { ok: false, status: 404, error: "Notification action expired or was not found." };

  const actionRow = row as NativeActionRow;
  if (actionRow.used_at) return { ok: false, status: 409, error: "Notification action was already used." };
  if (new Date(actionRow.expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 410, error: "Notification action expired." };
  }

  const { data: consumed, error: consumeError } = await supabaseAdmin
    .from("notification_action_tokens")
    .update({ used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", actionRow.id)
    .is("used_at", null)
    .select("id")
    .maybeSingle();

  if (consumeError) return { ok: false, status: 500, error: consumeError.message };
  if (!consumed) return { ok: false, status: 409, error: "Notification action was already used." };

  return { ok: true, row: actionRow };
}

async function driverIdForUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("driver_accounts")
    .select("driver_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.driver_id ? String(data.driver_id) : null;
}

async function respondToTripOffer(row: NativeActionRow, action: "accept" | "decline") {
  if (row.role !== "driver") return jsonError("Only drivers can respond to trip offers.", 403);

  const driverId = await driverIdForUser(row.user_id);
  if (!driverId) return jsonError("Driver account is not linked.", 403);

  const atomicResponse = await respondToAtomicOffer({
    tripId: row.trip_id,
    driverId,
    action,
    source: "native_notification",
  });
  return atomicResponse.ok
    ? NextResponse.json({ ok: true, message: action === "accept" ? "Trip accepted." : "Trip declined." })
    : jsonError(atomicResponse.error ?? "Offer is no longer available.", atomicResponse.status);
}

async function replyToChat(row: NativeActionRow, replyText: string) {
  if (row.role !== "customer" && row.role !== "driver") {
    return jsonError("Only customer and driver chat replies are supported.", 403);
  }

  const normalized = normalizeTripMessageBody(replyText);
  if (!normalized.ok) return jsonError(normalized.error, 400);

  const { data: trip, error: tripError } = await supabaseAdmin
    .from("trips")
    .select("id,status,customer_auth_user_id,driver_id")
    .eq("id", row.trip_id)
    .maybeSingle();

  if (tripError) return jsonError(tripError.message, 500);
  if (!trip) return jsonError("Trip not found.", 404);
  if (!CHAT_SENDABLE_STATUSES.has(String(trip.status ?? ""))) {
    return jsonError("Chat is read-only for this trip status.", 400);
  }

  if (row.role === "customer" && trip.customer_auth_user_id !== row.user_id) {
    return jsonError("You do not have access to this trip chat.", 403);
  }

  if (row.role === "driver") {
    const driverId = await driverIdForUser(row.user_id);
    if (!driverId || driverId !== trip.driver_id) {
      return jsonError("You do not have access to this trip chat.", 403);
    }
  }

  const { data: message, error: insertError } = await supabaseAdmin
    .from("trip_messages")
    .insert({
      trip_id: row.trip_id,
      sender_user_id: row.user_id,
      sender_role: row.role,
      body: normalized.body,
    })
    .select("id")
    .single();

  if (insertError || !message) {
    return jsonError(insertError?.message || "Failed to send message.", 500);
  }

  const preview = chatPreview(normalized.body);
  try {
    if (row.role === "customer") {
      await notifyDriverForTrip(row.trip_id, "New MOOVU message", preview, `/driver?chat=1&tripId=${row.trip_id}`, {
        nativeActionType: "chat_reply",
        tripId: row.trip_id,
      });
    } else {
      await notifyCustomerForTrip(row.trip_id, "New MOOVU message", preview, `/ride/${row.trip_id}?chat=1`, {
        nativeActionType: "chat_reply",
        tripId: row.trip_id,
      });
    }
  } catch (error: unknown) {
    console.error("[native-actions] chat reply notification failed", {
      tripId: row.trip_id,
      role: row.role,
      reason: error instanceof Error ? error.message : "Unknown push error",
    });
  }

  return NextResponse.json({ ok: true, message: "Reply sent." });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    const action = typeof body?.action === "string" ? body.action.trim() : "";
    const replyText = typeof body?.replyText === "string" ? body.replyText : "";

    if (!token) return jsonError("Missing notification action token.", 400);

    const consumed = await consumeActionToken(token);
    if (!consumed.ok) return jsonError(consumed.error, consumed.status);

    if (consumed.row.action_type === "trip_offer") {
      if (action !== "accept" && action !== "decline") return jsonError("Invalid trip offer action.", 400);
      return respondToTripOffer(consumed.row, action);
    }

    if (consumed.row.action_type === "chat_reply") {
      if (action !== "reply") return jsonError("Invalid chat action.", 400);
      return replyToChat(consumed.row, replyText);
    }

    return jsonError("Unsupported notification action.", 400);
  } catch (error: unknown) {
    return jsonError(error instanceof Error ? error.message : "Notification action failed.", 500);
  }
}
