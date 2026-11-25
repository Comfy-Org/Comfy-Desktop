import { defineAsyncComponent, type Component } from 'vue'

const files = import.meta.glob<{ default: Component }>('./V*.vue')
const metas = import.meta.glob<{ label: string }>('./V*.meta.ts', { eager: true })

const ids = Object.keys(files)
  .map((path) => path.slice(2, -4))
  .sort()

export const CREATE_LOOKS: { value: string; label: string }[] = [
  { value: 'current', label: 'Current' },
  ...ids.map((id) => ({
    value: id,
    label: `${id.slice(1)} · ${metas[`./${id}.meta.ts`]?.label ?? id}`
  }))
]

const loaded = new Map<string, Component>()

export function lookComponent(id: string): Component | undefined {
  const load = files[`./${id}.vue`]
  if (!load) return undefined
  if (!loaded.has(id)) loaded.set(id, defineAsyncComponent(load))
  return loaded.get(id)
}
