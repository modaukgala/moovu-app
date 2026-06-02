export type DriverLevel = {
  label: "Bronze" | "Silver" | "Gold" | "Platinum";
  minTrips: number;
  className: string;
};

export function getDriverLevel(completedTrips: number | null | undefined): DriverLevel {
  const trips = Number(completedTrips ?? 0);

  if (trips >= 1000) {
    return {
      label: "Platinum",
      minTrips: 1000,
      className: "border-slate-200 bg-slate-950 text-white",
    };
  }

  if (trips >= 500) {
    return {
      label: "Gold",
      minTrips: 500,
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }

  if (trips >= 100) {
    return {
      label: "Silver",
      minTrips: 100,
      className: "border-slate-200 bg-slate-100 text-slate-700",
    };
  }

  return {
    label: "Bronze",
    minTrips: 0,
    className: "border-orange-200 bg-orange-50 text-orange-800",
  };
}
