import { reactive, ref } from 'vue'
import { count, notify } from './undo'

/**
 * In-memory lists behind Mar's library pages. Module-level, so a rename
 * or a delete survives leaving the page; a reload brings the mock back.
 * Every change that loses something comes with an Undo.
 */
export interface Base {
  id: string
  name: string
  project?: string
  fav?: boolean
}

export function collection<T extends Base>(seed: T[], noun: string) {
  const items = reactive(seed) as T[]
  let copies = 0

  const at = (id: string): number => items.findIndex((i) => i.id === id)

  function rename(id: string, name: string): void {
    const it = items[at(id)]
    const next = name.trim()
    if (!it || !next || next === it.name) return
    const before = it.name
    it.name = next
    notify(`Renamed to “${next}”`, () => (it.name = before))
  }

  function remove(ids: string[], quiet = false): void {
    const gone = ids
      .map((id) => ({ i: at(id), item: items[at(id)]! }))
      .filter((g) => g.i >= 0)
      .sort((a, b) => b.i - a.i)
    for (const g of gone) items.splice(g.i, 1)
    if (quiet) return
    const label =
      gone.length === 1 ? `Deleted “${gone[0]!.item.name}”` : `Deleted ${count(gone.length, noun)}`
    notify(label, () => {
      for (const g of [...gone].reverse()) items.splice(g.i, 0, g.item)
    })
  }

  function duplicate(id: string): T | undefined {
    const i = at(id)
    const it = items[i]
    if (!it) return undefined
    const copy = { ...it, id: `${it.id}-copy-${++copies}`, name: `${it.name} copy`, fav: false }
    items.splice(i + 1, 0, copy)
    notify(`Duplicated “${it.name}”`, () => {
      const j = at(copy.id)
      if (j >= 0) items.splice(j, 1)
    })
    return copy
  }

  function move(ids: string[], project: string | undefined): void {
    const before = ids.map((id) => [id, items[at(id)]?.project] as const)
    for (const id of ids) {
      const it = items[at(id)]
      if (it) it.project = project
    }
    const what = ids.length === 1 ? `“${items[at(ids[0]!)]?.name}”` : count(ids.length, noun)
    notify(project ? `Moved ${what} to ${project}` : `Took ${what} out of its project`, () => {
      for (const [id, p] of before) {
        const it = items[at(id)]
        if (it) it.project = p
      }
    })
  }

  function star(id: string): void {
    const it = items[at(id)]
    if (it) it.fav = !it.fav
  }

  return { items, rename, remove, duplicate, move, star }
}

/** Multi-select: ⌘/Ctrl-click or the checkbox adds, Shift-click takes a
 *  range, Esc clears. */
export function selection() {
  const ids = ref(new Set<string>())
  let last = ''

  function toggle(id: string, order?: string[], range = false): void {
    const next = new Set(ids.value)
    if (range && last && order) {
      const a = order.indexOf(last)
      const b = order.indexOf(id)
      for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x)
    } else if (next.has(id)) next.delete(id)
    else next.add(id)
    last = id
    ids.value = next
  }
  function clear(): void {
    ids.value = new Set()
  }
  function all(list: string[]): void {
    ids.value = new Set(list)
  }
  return { ids, toggle, clear, all, has: (id: string) => ids.value.has(id) }
}
