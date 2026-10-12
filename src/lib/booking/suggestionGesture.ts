export function isSuggestionTap(startY: number | null, endY: number): boolean {
  return startY != null && Math.abs(endY - startY) < 10;
}
