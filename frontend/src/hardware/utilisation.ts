/** Budget-utilisation helpers shared by the hardware overview and project list. */

/** Share of `total` taken by `value`, clamped to 0..100 and safe when there is no total. */
export function share(value: number, total: number): number {
  if (!(total > 0)) return 0
  return Math.max(0, Math.min(100, (value / total) * 100))
}

/** Colour carries urgency here, so the percentage is always spelled out beside the bar. */
export function utilisationTone(ratio: number): string {
  if (ratio > 100) return 'bg-rose-500'
  if (ratio >= 90) return 'bg-amber-500'
  return 'bg-indigo-500'
}
