export type ZarCents = bigint & { readonly __zarCents: unique symbol };

const DECIMAL_MONEY = /^(-?)(\d+)(?:\.(\d+))?$/;

export function zarDecimalToCents(value: string | number): ZarCents {
  const raw = typeof value === "number" ? String(value) : value.trim();
  const match = DECIMAL_MONEY.exec(raw);
  if (!match) throw new Error("Money must be a finite decimal amount.");

  const [, sign, whole, fraction = ""] = match;
  const padded = `${fraction}000`;
  const cents = BigInt(whole) * BigInt(100) + BigInt(padded.slice(0, 2));
  const rounded = padded[2] >= "5" ? cents + BigInt(1) : cents;
  return (sign === "-" ? -rounded : rounded) as ZarCents;
}

export function positiveZarCents(value: string | number | bigint): ZarCents {
  const cents = typeof value === "bigint" ? value : zarDecimalToCents(value);
  if (cents <= BigInt(0)) throw new Error("Ledger entry amounts must be greater than zero.");
  return cents as ZarCents;
}

export function formatZarCents(value: bigint): string {
  const sign = value < BigInt(0) ? "-" : "";
  const absolute = value < BigInt(0) ? -value : value;
  return `${sign}R${absolute / BigInt(100)}.${String(absolute % BigInt(100)).padStart(2, "0")}`;
}
