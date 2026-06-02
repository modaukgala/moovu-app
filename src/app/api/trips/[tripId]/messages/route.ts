import { NextResponse } from "next/server";
import {
  chatPreview,
  getTripChatAccess,
  normalizeTripMessageBody,
  type TripChatMessage,
} from "@/lib/trip-chat";
import { notifyCustomerForTrip, notifyDriverForTrip } from "@/lib/push-notify";

function getTripIdFromRequest(req: Request) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const tripsIndex = parts.indexOf("trips");
  return tripsIndex >= 0 ? parts[tripsIndex + 1] || "" : "";
}

export async function GET(req: Request) {
  try {
    const tripId = getTripIdFromRequest(req);

    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Missing trip ID." }, { status: 400 });
    }

    const auth = await getTripChatAccess(req, tripId);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const url = new URL(req.url);
    const shouldMarkRead = url.searchParams.get("markRead") === "1";

    if (shouldMarkRead) {
      const otherRole = auth.access.role === "customer" ? "driver" : "customer";
      const { error: readError } = await auth.access.supabaseAdmin
        .from("trip_messages")
        .update({ read_at: new Date().toISOString() })
        .eq("trip_id", tripId)
        .eq("sender_role", otherRole)
        .is("read_at", null);

      if (readError) {
        console.error("[trip-chat] failed to mark messages read", {
          tripId,
          role: auth.access.role,
          reason: readError.message,
        });
      }
    }

    const { data, error } = await auth.access.supabaseAdmin
      .from("trip_messages")
      .select("id,trip_id,sender_user_id,sender_role,body,created_at,read_at")
      .eq("trip_id", tripId)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) {
      console.error("[trip-chat] message load failed", {
        tripId,
        role: auth.access.role,
        reason: error.message,
      });
      return NextResponse.json(
        { ok: false, error: "Unable to load messages. Try again." },
        { status: 500 },
      );
    }

    const messages = (data ?? []) as TripChatMessage[];
    const unreadCount = messages.filter(
      (message) => message.sender_role !== auth.access.role && !message.read_at,
    ).length;

    return NextResponse.json({
      ok: true,
      messages,
      role: auth.access.role,
      canSend: auth.access.canSend,
      unreadCount,
      readOnlyReason: auth.access.canSend
        ? null
        : "Chat is read-only after a trip is completed or cancelled.",
    });
  } catch (error: unknown) {
    console.error("[trip-chat] load route failed", {
      error: error instanceof Error ? error.message : "Unknown chat load error",
    });
    return NextResponse.json(
      { ok: false, error: "Unable to load messages. Try again." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const tripId = getTripIdFromRequest(req);

    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Missing trip ID." }, { status: 400 });
    }

    const auth = await getTripChatAccess(req, tripId);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    if (!auth.access.canSend) {
      return NextResponse.json(
        { ok: false, error: "Chat is read-only for this trip status." },
        { status: 400 },
      );
    }

    const body = (await req.json().catch(() => null)) as unknown;
    const normalized = normalizeTripMessageBody(
      typeof body === "object" && body !== null && "body" in body
        ? (body as Record<string, unknown>).body
        : null,
    );

    if (!normalized.ok) {
      return NextResponse.json({ ok: false, error: normalized.error }, { status: 400 });
    }

    const { data, error } = await auth.access.supabaseAdmin
      .from("trip_messages")
      .insert({
        trip_id: tripId,
        sender_user_id: auth.access.userId,
        sender_role: auth.access.role,
        body: normalized.body,
      })
      .select("id,trip_id,sender_user_id,sender_role,body,created_at,read_at")
      .single();

    if (error || !data) {
      console.error("[trip-chat] message insert failed", {
        tripId,
        role: auth.access.role,
        reason: error?.message || "No inserted message returned.",
      });
      return NextResponse.json(
        { ok: false, error: "Message could not be sent. Please try again." },
        { status: 500 },
      );
    }

    const preview = chatPreview(normalized.body);

    try {
      if (auth.access.role === "customer") {
        await notifyDriverForTrip(
          tripId,
          "New MOOVU message",
          preview,
          `/driver?chat=1&tripId=${tripId}`,
          {
            nativeActionType: "chat_reply",
            tripId,
          },
        );
      } else {
        await notifyCustomerForTrip(
          tripId,
          "New MOOVU message",
          preview,
          `/ride/${tripId}?chat=1`,
          {
            nativeActionType: "chat_reply",
            tripId,
          },
        );
      }
    } catch (pushError: unknown) {
      console.error("[trip-chat] push notification failed", {
        tripId,
        role: auth.access.role,
        error: pushError instanceof Error ? pushError.message : "Unknown push error",
      });
    }

    return NextResponse.json({
      ok: true,
      message: data as TripChatMessage,
      canSend: auth.access.canSend,
    });
  } catch (error: unknown) {
    console.error("[trip-chat] send route failed", {
      error: error instanceof Error ? error.message : "Unknown chat send error",
    });
    return NextResponse.json(
      { ok: false, error: "Message could not be sent. Please try again." },
      { status: 500 },
    );
  }
}
