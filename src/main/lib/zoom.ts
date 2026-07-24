export function convertLevelToZoomPercent(level: number): number {
  return Math.round(Math.pow(1.2, level) * 100)
}
