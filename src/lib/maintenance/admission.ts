export const ADMISSION_CLOSED_CODE = "MOOVU_ADMISSION_CLOSED";
export const ADMISSION_CLOSED_MESSAGE =
  "New bookings and payment checkouts are briefly unavailable. Existing trips and payments remain available.";

export function isAdmissionClosed(error: { message?: string } | null | undefined): boolean {
  return String(error?.message ?? "").includes(ADMISSION_CLOSED_CODE);
}
