import { reactive } from 'vue'

/**
 * Color labels (Alex Tov's media-assets proto): one per file, to mark
 * picks and rejects at a glance. Kept for the visit, like tag edits.
 * Six to start; Add label (the sidebar's LABELS) makes more, each in
 * the next free color.
 */
export interface LabelDef {
  value: string
  label: string
  color: string
  /** Its hue, for the sidebar's By color. */
  hue: number
}
const hued = (value: string, label: string, l: number, c: number, hue: number): LabelDef => ({
  value,
  label,
  color: `oklch(${l} ${c} ${hue})`,
  hue
})
export const LABELS = reactive<LabelDef[]>([
  hued('red', 'Red', 0.66, 0.2, 25),
  hued('orange', 'Orange', 0.74, 0.17, 55),
  hued('yellow', 'Yellow', 0.85, 0.16, 95),
  hued('green', 'Green', 0.72, 0.17, 150),
  hued('blue', 'Blue', 0.66, 0.16, 250),
  hued('purple', 'Purple', 0.64, 0.19, 305)
])
export type AssetLabel = string

/** Colors a new label takes, in turn: between the six, so it reads apart. */
const MORE = [195, 340, 120, 275, 75, 220, 10, 165]

const set = reactive<Record<string, AssetLabel>>({})
export const labelOf = (id: string): AssetLabel | undefined => set[id]
export const labelColor = (l?: string): string | undefined =>
  LABELS.find((x) => x.value === l)?.color
export const labelName = (l?: string): string | undefined =>
  LABELS.find((x) => x.value === l)?.label
/** Picking the label it has takes it off. */
export function setLabel(ids: string[], l: AssetLabel): void {
  const off = ids.every((id) => set[id] === l)
  for (const id of ids) {
    if (off) delete set[id]
    else set[id] = l
  }
}
/** A label of your own; a name already taken returns that one. */
export function addLabel(name: string): LabelDef | undefined {
  const label = name.trim()
  if (!label) return undefined
  const had = LABELS.find((x) => x.label.toLowerCase() === label.toLowerCase())
  if (had) return had
  const n = LABELS.length - 6
  const def = hued(`custom-${n + 1}`, label, 0.72, 0.15, MORE[n % MORE.length]!)
  LABELS.push(def)
  return def
}

/** No label: takes the label off every one. */
export function clearLabel(ids: string[]): void {
  for (const id of ids) delete set[id]
}

/** Custom order: a label dragged to another's place in the sidebar. */
export function moveLabel(from: string, to: string): void {
  const i = LABELS.findIndex((x) => x.value === from)
  const j = LABELS.findIndex((x) => x.value === to)
  if (i < 0 || j < 0 || i === j) return
  const [def] = LABELS.splice(i, 1)
  LABELS.splice(j, 0, def!)
}
