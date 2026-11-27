/** Offers in a row a driver can leave unanswered before being set offline. */
export const MISSED_OFFERS_BEFORE_OFFLINE = 2;

type RecentOffer = { driver_id: string; status: string; offered_at: string };

/**
 * A driver is "away" when their latest offers all expired unanswered and the app
 * has not been heard from since the first of them. Pure so it can be tested.
 */
export function findAwayDrivers(
  offers: RecentOffer[],
  lastSeenByDriver: Map<string, string | null>,
  missedLimit = MISSED_OFFERS_BEFORE_OFFLINE,
) {
  const byDriver = new Map<string, RecentOffer[]>();
  for (const offer of offers) {
    const list = byDriver.get(offer.driver_id) ?? [];
    list.push(offer);
    byDriver.set(offer.driver_id, list);
  }
  const away = new Set<string>();
  for (const [driverId, list] of byDriver) {
    // Several offers for the same trip in one round count once per trip moment.
    const latest = [...list].sort((a, b) => b.offered_at.localeCompare(a.offered_at)).slice(0, missedLimit);
    if (latest.length < missedLimit || latest.some((offer) => offer.status !== "expired")) continue;
    const firstMissedAt = latest.at(-1)!.offered_at;
    const lastSeen = lastSeenByDriver.get(driverId);
    if (!lastSeen || new Date(lastSeen).getTime() < new Date(firstMissedAt).getTime()) away.add(driverId);
  }
  return away;
}

