export function toE164ZA(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/[^\d+]/g, "").trim();

  if (s.startsWith("+27")) return "27" + s.slice(3);
  if (s.startsWith("27") && s.length >= 11) return s;
  if (s.startsWith("0") && s.length === 10) return "27" + s.slice(1);

  return null;
}

export function waLinkZA(phone: string | null | undefined, message: string): string | null {
  const e164 = toE164ZA(phone);
  if (!e164) return null;
  return `https://wa.me/${e164}?text=${encodeURIComponent(message)}`;
}