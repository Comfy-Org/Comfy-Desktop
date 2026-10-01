/**
 * Small shared constants + helpers for the Benchmarks area (History + Compare).
 *
 * Kept in one module so History and Compare cannot drift: the series ramp MUST be
 * a single source of truth (the History row accent, the Compare legend, and every
 * Compare chart all index into it, so a column's color stays identical everywhere),
 * and the export filename builder is identical in both views.
 */

/**
 * Column series colors — one ramp shared by the History row accent and the Compare
 * legend + charts so a given column keeps the same color across the whole area.
 */
export const seriesColors = [
  '#55e0d1',
  '#a970ff',
  '#f6f31b',
  '#ff8a65',
  '#62a8ff',
  '#ff6fae',
  '#7ee081'
]

/** Build the data-export filename base: `comfy-benchmarks-<n>-runs-YYYY-MM-DD.<ext>`. */
export function exportBaseName(count: number, extension: 'csv' | 'json'): string {
  const now = new Date()
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`
  return `comfy-benchmarks-${count}-runs-${iso}.${extension}`
}
