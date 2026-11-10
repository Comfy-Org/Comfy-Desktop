import { reactive } from 'vue'

/**
 * Color labels (Alex Tov's media-assets proto): one per file, to mark
 * picks and rejects at a glance. Kept for the visit, like tag edits.
 */
export const LABELS = [
  { value: 'red', label: 'Red', color: 'oklch(0.66 0.2 25)' },
  { value: 'orange', label: 'Orange', color: 'oklch(0.74 0.17 55)' },
  { value: 'yellow', label: 'Yellow', color: 'oklch(0.85 0.16 95)' },
  { value: 'green', label: 'Green', color: 'oklch(0.72 0.17 150)' },
  { value: 'blue', label: 'Blue', color: 'oklch(0.66 0.16 250)' },
  { value: 'purple', label: 'Purple', color: 'oklch(0.64 0.19 305)' }
] as const
export type AssetLabel = (typeof LABELS)[number]['value']

const set = reactive<Record<string, AssetLabel>>({})
export const labelOf = (id: string): AssetLabel | undefined => set[id]
export const labelColor = (l?: string): string | undefined =>
  LABELS.find((x) => x.value === l)?.color
/** Picking the label it has takes it off. */
export function setLabel(ids: string[], l: AssetLabel): void {
  const off = ids.every((id) => set[id] === l)
  for (const id of ids) {
    if (off) delete set[id]
    else set[id] = l
  }
}
