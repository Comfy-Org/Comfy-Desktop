import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef } from 'vue'
import { FolderInput, FolderMinus } from 'lucide-vue-next'
import type { Base, collection } from './collection'
import { selection } from './collection'
import { projectNames } from './projectsStore'
import type { MenuAction, MenuLine } from './menu'

/**
 * The wiring every library page in Mar's proposal shares: selection
 * (with ⌘A, Delete and Esc), rename in place, and Move to project.
 * `select: false` (Builds) leaves selection and its keys out. A page can
 * add ⌘C (`copy`) and the digit keys (`digit`, 0 to 9) for its selection.
 */
export function useLibrary<T extends Base>(
  col: ReturnType<typeof collection<T>>,
  shown: ComputedRef<T[]>,
  {
    select = true,
    copy,
    digit
  }: {
    select?: boolean
    /** ⌘C / Ctrl+C with something selected. */
    copy?: (ids: string[]) => void
    /** A digit key, no modifiers, with something selected (Assets: labels). */
    digit?: (n: number, ids: string[]) => void
  } = {}
) {
  const sel = selection()
  const renaming = ref('')
  const order = computed(() => shown.value.map((i) => i.id))
  const selected = computed(() => [...sel.ids.value])

  function pick(id: string, range: boolean): void {
    sel.toggle(id, order.value, range)
  }
  function rename(id: string, name: string): void {
    col.rename(id, name)
    renaming.value = ''
  }
  function removeSelected(): void {
    col.remove(selected.value)
    sel.clear()
  }

  /** Move to project ›, as a menu line for one item or the selection. */
  function moveLine(ids: () => string[], current?: string): MenuAction {
    const names = projectNames()
    const sub: MenuLine[] = names.map((n) => ({
      label: n,
      checked: current === n,
      run: () => {
        col.move(ids(), n)
        sel.clear()
      }
    }))
    return {
      label: 'Move to project',
      icon: FolderInput,
      sub: [
        ...(sub as MenuAction[]),
        {
          label: 'No project',
          icon: FolderMinus,
          disabled: current === undefined && ids().length === 1,
          run: () => {
            col.move(ids(), undefined)
            sel.clear()
          }
        }
      ]
    }
  }

  function key(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (e.key === 'Escape' && sel.ids.value.size) sel.clear()
    else if ((e.metaKey || e.ctrlKey) && e.key === 'a' && shown.value.length) {
      e.preventDefault()
      sel.all(order.value)
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && sel.ids.value.size) {
      e.preventDefault()
      removeSelected()
    } else if (
      copy &&
      (e.metaKey || e.ctrlKey) &&
      e.key.toLowerCase() === 'c' &&
      sel.ids.value.size &&
      !window.getSelection()?.toString()
    ) {
      e.preventDefault()
      copy(selected.value)
    } else if (
      digit &&
      /^[0-9]$/.test(e.key) &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      sel.ids.value.size
    ) {
      e.preventDefault()
      digit(Number(e.key), selected.value)
    }
  }
  if (select) {
    onMounted(() => window.addEventListener('keydown', key))
    onBeforeUnmount(() => window.removeEventListener('keydown', key))
  }

  return { sel, renaming, order, selected, pick, rename, removeSelected, moveLine }
}
