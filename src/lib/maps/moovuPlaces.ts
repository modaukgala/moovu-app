export type MoovuKnownPlace = {
  id: string;
  name: string;
  description: string;
  formattedAddress: string;
  lat: number;
  lng: number;
  keywords: string[];
};

export const MOOVU_OPERATING_CENTER = {
  lat: -25.11015,
  lng: 29.06548,
};

export const MOOVU_SEARCH_RADIUS_METERS = 35_000;

export const MOOVU_SEARCH_BOUNDS = {
  south: -25.36,
  west: 28.82,
  north: -24.88,
  east: 29.28,
};

const SYNTHETIC_PLACE_PREFIX = "moovu_known:";

const KNOWN_PLACES: MoovuKnownPlace[] = [
  {
    id: "siyabuswa_mall",
    name: "Siyabuswa Mall",
    description: "Siyabuswa Mall, Siyabuswa-A, Siyabuswa, South Africa",
    formattedAddress: "Siyabuswa Mall, Siyabuswa-A, Siyabuswa, 0472, South Africa",
    lat: -25.11015,
    lng: 29.06548,
    keywords: [
      "siyabuswa mall",
      "siyabuswa-a mall",
      "siyabuswa a mall",
      "mall siyabuswa",
      "siyabuswamall",
    ],
  },
];

export function syntheticPlaceId(id: string) {
  return `${SYNTHETIC_PLACE_PREFIX}${id}`;
}

export function isSyntheticPlaceId(placeId: string) {
  return placeId.startsWith(SYNTHETIC_PLACE_PREFIX);
}

export function knownPlaceFromSyntheticId(placeId: string) {
  if (!isSyntheticPlaceId(placeId)) return null;
  const id = placeId.slice(SYNTHETIC_PLACE_PREFIX.length);
  return KNOWN_PLACES.find((place) => place.id === id) ?? null;
}

function normalizePlaceText(value: string) {
  return value
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function findKnownPlace(input: string) {
  const normalized = normalizePlaceText(input);
  if (!normalized) return null;

  return (
    KNOWN_PLACES.find((place) =>
      place.keywords.some((keyword) => {
        const normalizedKeyword = normalizePlaceText(keyword);
        return normalized === normalizedKeyword || normalized.includes(normalizedKeyword);
      })
    ) ?? null
  );
}

export function knownPlacePrediction(place: MoovuKnownPlace) {
  return {
    description: place.description,
    place_id: syntheticPlaceId(place.id),
  };
}

export function localizedSearchQueries(input: string) {
  const clean = input.trim();
  const lower = clean.toLowerCase();
  const alreadyLocal =
    lower.includes("siyabuswa") ||
    lower.includes("mpumalanga") ||
    lower.includes("dr js moroka") ||
    lower.includes("south africa");

  if (alreadyLocal) {
    return [
      `${clean}, Mpumalanga, South Africa`,
      `${clean}, South Africa`,
    ];
  }

  return [
    `${clean}, Siyabuswa-A, Siyabuswa, Mpumalanga, South Africa`,
    `${clean}, Siyabuswa, Mpumalanga, South Africa`,
    `${clean}, South Africa`,
  ];
}

export function googleBoundsParam() {
  return `${MOOVU_SEARCH_BOUNDS.south},${MOOVU_SEARCH_BOUNDS.west}|${MOOVU_SEARCH_BOUNDS.north},${MOOVU_SEARCH_BOUNDS.east}`;
}

export function googleLocationParam() {
  return `${MOOVU_OPERATING_CENTER.lat},${MOOVU_OPERATING_CENTER.lng}`;
}
