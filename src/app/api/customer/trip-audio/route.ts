import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedCustomer } from "@/lib/customer/server";

const BUCKET = "trip-audio-recordings";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const RECENT_COMPLETED_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACTIVE_RECORDING_STATUSES = new Set(["assigned", "arrived", "ongoing"]);

type TripForAudio = {
  id: string;
  customer_id: string;
  driver_id: string | null;
  status: string | null;
  completed_at?: string | null;
  created_at?: string | null;
};

function errorMessage(error: unknown, fallback = "Server error.") {
  return error instanceof Error ? error.message : fallback;
}

function safeAudioExtension(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("aac")) return "aac";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

function isTripAllowedForRecording(trip: TripForAudio) {
  const status = String(trip.status ?? "").toLowerCase();
  if (ACTIVE_RECORDING_STATUSES.has(status)) return true;

  if (status !== "completed") return false;

  const completedAt = trip.completed_at || trip.created_at;
  if (!completedAt) return false;

  const completedMs = new Date(completedAt).getTime();
  return Number.isFinite(completedMs) && Date.now() - completedMs <= RECENT_COMPLETED_WINDOW_MS;
}

async function loadCustomerTrip(
  supabaseAdmin: SupabaseClient,
  tripId: string,
  customerId: string,
) {
  const { data, error } = await supabaseAdmin
    .from("trips")
    .select("id,customer_id,driver_id,status,completed_at,created_at")
    .eq("id", tripId)
    .eq("customer_id", customerId)
    .maybeSingle();

  if (error) {
    console.error("[trip-audio] failed to load trip", { tripId, message: error.message, code: error.code });
    return { ok: false as const, status: 500, error: "Could not verify this trip. Please try again." };
  }

  if (!data) {
    return { ok: false as const, status: 404, error: "Trip not found." };
  }

  return { ok: true as const, trip: data as TripForAudio };
}

async function signedUrlForPath(
  supabaseAdmin: SupabaseClient,
  path: string,
) {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60 * 15, {
    download: false,
  });

  if (error) {
    console.error("[trip-audio] signed url failed", { path, message: error.message });
    return null;
  }

  return data.signedUrl;
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthenticatedCustomer(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const url = new URL(req.url);
    const tripId = String(url.searchParams.get("tripId") ?? "").trim();

    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Trip ID is required." }, { status: 400 });
    }

    const tripResult = await loadCustomerTrip(auth.supabaseAdmin, tripId, auth.customer.id);
    if (!tripResult.ok) {
      return NextResponse.json({ ok: false, error: tripResult.error }, { status: tripResult.status });
    }

    const { data, error } = await auth.supabaseAdmin
      .from("trip_audio_recordings")
      .select("id,trip_id,file_path,file_name,mime_type,duration_seconds,status,created_at")
      .eq("trip_id", tripId)
      .eq("customer_id", auth.customer.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[trip-audio] failed to load recordings", { tripId, message: error.message, code: error.code });
      return NextResponse.json(
        { ok: false, error: "Could not load safety recordings. Please try again." },
        { status: 500 },
      );
    }

    const recordings = await Promise.all(
      (data ?? []).map(async (row) => ({
        ...row,
        url: await signedUrlForPath(auth.supabaseAdmin, String(row.file_path)),
      })),
    );

    return NextResponse.json({ ok: true, recordings });
  } catch (error: unknown) {
    console.error("[trip-audio] GET unexpected", { message: errorMessage(error) });
    return NextResponse.json(
      { ok: false, error: "Could not load safety recordings. Please try again." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let uploadedPath: string | null = null;

  try {
    const auth = await getAuthenticatedCustomer(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const form = await req.formData();
    const tripId = String(form.get("tripId") ?? "").trim();
    const durationSeconds = Math.max(0, Math.round(Number(form.get("durationSeconds") ?? 0)));
    const file = form.get("file");

    if (!tripId) {
      return NextResponse.json({ ok: false, error: "Trip ID is required." }, { status: 400 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Choose an audio recording to save." }, { status: 400 });
    }

    if (!file.type.startsWith("audio/")) {
      return NextResponse.json({ ok: false, error: "Only audio recordings can be saved." }, { status: 400 });
    }

    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Recording is too large. Please keep safety recordings under 50 MB." },
        { status: 400 },
      );
    }

    const tripResult = await loadCustomerTrip(auth.supabaseAdmin, tripId, auth.customer.id);
    if (!tripResult.ok) {
      return NextResponse.json({ ok: false, error: tripResult.error }, { status: tripResult.status });
    }

    if (!isTripAllowedForRecording(tripResult.trip)) {
      return NextResponse.json(
        { ok: false, error: "Safety recording is only available during active trips or shortly after completion." },
        { status: 403 },
      );
    }

    const recordingId = crypto.randomUUID();
    const extension = safeAudioExtension(file.type);
    const path = `trips/${tripId}/audio/${recordingId}.${extension}`;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await auth.supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("[trip-audio] storage upload failed", { tripId, message: uploadError.message });
      return NextResponse.json(
        { ok: false, error: "Could not save this recording. Please try again." },
        { status: 500 },
      );
    }

    uploadedPath = path;

    const fileName = `MOOVU-safety-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
    const { data: inserted, error: insertError } = await auth.supabaseAdmin
      .from("trip_audio_recordings")
      .insert({
        id: recordingId,
        trip_id: tripId,
        customer_id: auth.customer.id,
        driver_id: tripResult.trip.driver_id,
        file_path: path,
        file_name: fileName,
        mime_type: file.type,
        duration_seconds: durationSeconds,
        status: "active",
      })
      .select("id,trip_id,file_path,file_name,mime_type,duration_seconds,status,created_at")
      .single();

    if (insertError || !inserted) {
      console.error("[trip-audio] metadata insert failed", {
        tripId,
        message: insertError?.message,
        code: insertError?.code,
      });

      await auth.supabaseAdmin.storage.from(BUCKET).remove([path]).catch(() => {});
      uploadedPath = null;

      return NextResponse.json(
        { ok: false, error: "Recording uploaded, but MOOVU could not save it for review. Please try again." },
        { status: 500 },
      );
    }

    const signedUrl = await signedUrlForPath(auth.supabaseAdmin, path);

    return NextResponse.json({
      ok: true,
      recording: {
        ...inserted,
        url: signedUrl,
      },
      message: "Recording saved securely with this trip.",
    });
  } catch (error: unknown) {
    console.error("[trip-audio] POST unexpected", { message: errorMessage(error) });
    if (uploadedPath) {
      const auth = await getAuthenticatedCustomer(req).catch(() => null);
      if (auth?.ok) {
        await auth.supabaseAdmin.storage.from(BUCKET).remove([uploadedPath]).catch(() => {});
      }
    }
    return NextResponse.json(
      { ok: false, error: "Could not save this recording. Please try again." },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const auth = await getAuthenticatedCustomer(req);
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => null);
    const id = String(body?.id ?? "").trim();

    if (!id) {
      return NextResponse.json({ ok: false, error: "Recording ID is required." }, { status: 400 });
    }

    const { data: recording, error: loadError } = await auth.supabaseAdmin
      .from("trip_audio_recordings")
      .select("id,customer_id,status")
      .eq("id", id)
      .eq("customer_id", auth.customer.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (loadError) {
      console.error("[trip-audio] delete lookup failed", { id, message: loadError.message, code: loadError.code });
      return NextResponse.json(
        { ok: false, error: "Could not delete this recording. Please try again." },
        { status: 500 },
      );
    }

    if (!recording) {
      return NextResponse.json({ ok: false, error: "Recording not found." }, { status: 404 });
    }

    const { error: deleteError } = await auth.supabaseAdmin
      .from("trip_audio_recordings")
      .update({
        status: "deleted",
        deleted_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("customer_id", auth.customer.id);

    if (deleteError) {
      console.error("[trip-audio] delete update failed", { id, message: deleteError.message, code: deleteError.code });
      return NextResponse.json(
        { ok: false, error: "Could not delete this recording. Please try again." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, message: "Recording removed from your trip view." });
  } catch (error: unknown) {
    console.error("[trip-audio] DELETE unexpected", { message: errorMessage(error) });
    return NextResponse.json(
      { ok: false, error: "Could not delete this recording. Please try again." },
      { status: 500 },
    );
  }
}
