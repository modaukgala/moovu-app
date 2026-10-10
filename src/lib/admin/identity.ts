export type AdminPersonName = {
  first_name?: string | null;
  last_name?: string | null;
};

export function adminPersonName(person: AdminPersonName | null | undefined, fallback: string): string {
  const name = [person?.first_name, person?.last_name]
    .map(part => part?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  return name || fallback;
}

export function adminDriverName(person: AdminPersonName | null | undefined): string {
  return adminPersonName(person, person ? "Unnamed Driver" : "Driver profile unavailable");
}
