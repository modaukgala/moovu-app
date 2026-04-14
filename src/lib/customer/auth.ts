export function normalizePhoneZA(raw: string | null | undefined): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;

  const digits = value.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("27") && digits.length === 11) {
    return `0${digits.slice(2)}`;
  }

  if (digits.startsWith("0") && digits.length === 10) {
    return digits;
  }

  if (digits.length >= 10) {
    return digits;
  }

  return null;
}

export function digitsOnly(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

export function customerEmailFromPhone(raw: string | null | undefined): string {
  const normalized = normalizePhoneZA(raw);
  if (!normalized) {
    throw new Error("Invalid phone number.");
  }

  return `${digitsOnly(normalized)}@customer.moovu.local`;
}

export function fullCustomerName(firstName?: string | null, lastName?: string | null) {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

export function formatVehicleLabel(driver: {
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_color?: string | null;
  vehicle_registration?: string | null;
}) {
  const car = [driver.vehicle_color, driver.vehicle_make, driver.vehicle_model]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (driver.vehicle_registration) {
    return `${car || "Vehicle"} (${driver.vehicle_registration})`;
  }

  return car || "Vehicle";
}

export function buildTripShareMessage(params: {
  customerName: string;
  destination: string;
  driverName: string;
  driverPhone?: string | null;
  vehicleLabel: string;
  shareUrl: string;
}) {
  const driverPhonePart = params.driverPhone ? ` Driver phone: ${params.driverPhone}.` : "";

  return `${params.customerName} is sharing their trip with you and they are travelling to ${params.destination} with ${params.driverName} in ${params.vehicleLabel}.${driverPhonePart} Track the trip here: ${params.shareUrl}`;
}