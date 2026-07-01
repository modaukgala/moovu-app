export type DispatchScoreBreakdown = {
  distance: number;
  rotation: number;
  reliability: number;
  quality: number;
  missedPenalty: number;
  total: number;
};

export type DispatchCandidate = {
  driverId: string;
  distanceKm: number;
  roadEtaSeconds: number | null;
  score: number;
  scoreBreakdown: DispatchScoreBreakdown;
};

export type DispatchResult = {
  ok: boolean;
  tripId: string;
  offerId?: string | null;
  driverId?: string | null;
  expiresAt?: string | null;
  escalatesAt?: string | null;
  mode?: "atomic" | "legacy";
  schedulerQueued?: boolean;
  schedulerWarning?: string;
  exhausted?: boolean;
  error?: string;
};

export type OfferAction = "accept" | "decline";
