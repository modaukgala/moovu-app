import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  DEFAULT_SURGE_MODE,
  SURGE_MODES,
  getSurgeModeConfig,
  validateSurgeMode,
  type SurgeMode,
  type SurgeModeConfig,
} from "@/lib/domain/fare";

export const MANUAL_SURGE_SETTING_KEY = "manual_surge";

type ManualSurgeSettingRow = {
  value: unknown;
};

export type ActiveManualSurge = SurgeModeConfig;

function isMissingSettingsTableError(error: { code?: string; message?: string } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "42P01" || message.includes("app_pricing_settings") || message.includes("does not exist");
}

function parseStoredSurge(value: unknown): ActiveManualSurge {
  if (!value || typeof value !== "object") return SURGE_MODES[DEFAULT_SURGE_MODE];
  const mode = validateSurgeMode((value as { mode?: unknown }).mode);
  return getSurgeModeConfig(mode);
}

export async function getActiveManualSurge(): Promise<ActiveManualSurge> {
  const { data, error } = await supabaseAdmin
    .from("app_pricing_settings")
    .select("value")
    .eq("key", MANUAL_SURGE_SETTING_KEY)
    .maybeSingle<ManualSurgeSettingRow>();

  if (error) {
    if (!isMissingSettingsTableError(error)) {
      console.error("[manual-surge] failed to load setting", error);
    }
    return SURGE_MODES[DEFAULT_SURGE_MODE];
  }

  return parseStoredSurge(data?.value);
}

export async function setActiveManualSurge(modeValue: unknown, updatedBy: string) {
  const mode: SurgeMode = validateSurgeMode(modeValue);
  const config = getSurgeModeConfig(mode);

  const { data, error } = await supabaseAdmin
    .from("app_pricing_settings")
    .upsert(
      {
        key: MANUAL_SURGE_SETTING_KEY,
        value: config,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    )
    .select("value")
    .single<ManualSurgeSettingRow>();

  if (error) {
    console.error("[manual-surge] failed to save setting", error);
    return {
      ok: false as const,
      missingMigration: isMissingSettingsTableError(error),
      error,
    };
  }

  return {
    ok: true as const,
    surge: parseStoredSurge(data?.value),
  };
}
