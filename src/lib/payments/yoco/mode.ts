export type YocoMode = "test" | "live";

export function normalizeYocoMode(value: unknown): YocoMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "test" || normalized === "live" ? normalized : null;
}

export function yocoEventModeMatches(eventMode: unknown, configuredMode: unknown): boolean {
  const event = normalizeYocoMode(eventMode);
  const configured = normalizeYocoMode(configuredMode);
  return event !== null && configured !== null && event === configured;
}
