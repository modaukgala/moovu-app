/** Hide cents only when the stored amount is exactly a whole rand. */
export function formatFareRands(value: number): string {
  const cents = Math.round(value * 100);
  return cents % 100 === 0 ? `R${cents / 100}` : `R${(cents / 100).toFixed(2)}`;
}
