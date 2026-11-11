import { defineComponent, h, ref, type Component } from 'vue'
import { Bell, Copy, Download, FolderInput, Pencil, Trash2 } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Tooltip from '../../ui/Tooltip.vue'
import CreateMenu from '../CreateMenu.vue'
import WorkspaceMenu from '../../parts/WorkspaceMenu.vue'
import PromptBox from '../../parts/PromptBox.vue'
import DesktopTitleBar from '../../parts/DesktopTitleBar.vue'
import SwitcherMenu from '../../parts/nav/SwitcherMenu.vue'
import DeployedTo from '../../parts/space/DeployedTo.vue'
import Select from '../../ui/Select.vue'
import AssetLayoutMenu from '../assets/AssetLayoutMenu.vue'
import { GROUPS } from '../assets/assetGroups'
import MarItemMenu from '../pages/MarItemMenu.vue'
import type { MenuLine } from '../pages/menu'

/**
 * Components shown open, each in its own frame (kit/Stage.vue). `open`
 * runs once the component has rendered, the way a person would open it.
 */
export interface StageDef {
  component: Component
  height: number
  /** Where the trigger sits, so what opens has room. */
  place?: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'top-center'
  on?: 'main' | 'sidebar' | 'bare'
  open?: (root: HTMLElement) => void
}

const WORKSPACE = '[aria-haspopup="menu"]:not(.mar-credits-row)'

function pressMenu(selector = '[aria-haspopup="menu"]', highlight?: number) {
  return (root: HTMLElement): void => {
    root.querySelector<HTMLElement>(selector)?.click()
    if (highlight === undefined) return
    setTimeout(() => {
      const items = document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')
      items[highlight]?.setAttribute('data-highlighted', '')
    }, 200)
  }
}

/** Tooltips open as the pointer enters (the stage's provider has no
 *  delay). Focus would only open one: a single frame holds focus. */
function focusTip(root: HTMLElement): void {
  root
    .querySelector<HTMLElement>('[data-grace-area-trigger], button')
    ?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' }))
}

const tip = (content: string, icon: Component = Bell): Component =>
  defineComponent(
    () => () =>
      h(Tooltip, { content, side: 'bottom' }, () =>
        h(Button, { variant: 'ghost', size: 'icon-sm', 'aria-label': content }, () =>
          h(icon, { size: 15 })
        )
      )
  )

/** A Reka trigger opens on a click; a submenu row opens on →. */
function clickThen(selector: string, then?: () => void) {
  return (root: HTMLElement): void => {
    root.querySelector<HTMLElement>(selector)?.click()
    if (then) setTimeout(then, 250)
  }
}
function subOpen(text: string): () => void {
  return () => {
    const row = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find(
      (el) => el.textContent?.includes(text)
    )
    row?.focus()
    row?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  }
}

/** Assets' Layout menu (assets/AssetLayoutMenu.vue), with the page's own
 *  sorts and groups: rows with values, one submenu at a time. */
const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'largest', label: 'Largest first' },
  { value: 'name', label: 'Name (A → Z)' }
]
const layoutMenu = defineComponent(() => {
  const view = ref<'masonry' | 'rows' | 'grid'>('masonry')
  const size = ref(2)
  const sort = ref('newest')
  const group = ref('none')
  const name = ref(true)
  const details = ref(true)
  const labels = ref(false)
  return () =>
    h(
      'div',
      { class: 'mar-page is-embedded' },
      h(
        'div',
        { class: 'mar-page-bar' },
        h(AssetLayoutMenu, {
          view: view.value,
          'onUpdate:view': (v: typeof view.value) => (view.value = v),
          size: size.value,
          'onUpdate:size': (v?: number) => (size.value = v ?? 2),
          sort: sort.value,
          'onUpdate:sort': (v?: string) => (sort.value = v ?? 'newest'),
          group: group.value,
          'onUpdate:group': (v?: string) => (group.value = v ?? 'none'),
          showName: name.value,
          'onUpdate:showName': (v?: boolean) => (name.value = !!v),
          showDetails: details.value,
          'onUpdate:showDetails': (v?: boolean) => (details.value = !!v),
          showLabels: labels.value,
          'onUpdate:showLabels': (v?: boolean) => (labels.value = !!v),
          sorts: SORTS,
          groups: GROUPS,
          views: ['masonry', 'rows', 'grid']
        })
      )
    )
})

/** An item's ⋯ (pages/MarItemMenu.vue): a tag's, as in ComfyUI's Assets
 *  sidebar (its Delete asks first, in the menu), and a card's, with
 *  Move to project's second panel. The red line gets its divider on its own. */
const TAG_LINES: MenuLine[] = [
  { label: 'Rename tag', icon: Pencil },
  {
    label: 'Delete tag',
    icon: Trash2,
    danger: true,
    confirm: { text: 'Remove “portrait” from 4 assets?', yes: 'Delete tag' }
  }
]
const CARD_LINES: MenuLine[] = [
  { label: 'Rename', icon: Pencil },
  { label: 'Duplicate', icon: Copy },
  {
    label: 'Move to project',
    icon: FolderInput,
    sub: [{ label: 'Hero shots' }, { label: 'My first project' }, { label: 'Flux tests' }]
  },
  { label: 'Delete', icon: Trash2, danger: true }
]
const itemMenu = (lines: MenuLine[]): Component =>
  defineComponent(() => () => h(MarItemMenu, { lines }))

/** A single-choice dropdown (ui/Select.vue): the pick fills its row. */
const PLACES = [
  { value: 'all', label: 'All places' },
  { value: 'local', label: 'This computer' },
  { value: 'cloud', label: 'Comfy Cloud' }
]
const select = defineComponent(() => {
  const v = ref('local')
  return () =>
    h(Select, {
      modelValue: v.value,
      'onUpdate:modelValue': (x: string) => (v.value = x),
      options: PLACES,
      class: 'w-44'
    })
})

export const STAGES = {
  'create-menu': {
    component: CreateMenu,
    height: 150,
    place: 'top-right',
    open: pressMenu()
  },
  'create-menu-hover': {
    component: CreateMenu,
    height: 150,
    place: 'top-right',
    open: pressMenu(undefined, 0)
  },
  'workspace-menu': {
    component: defineComponent(() => () => h('div', { class: 'w-55' }, h(WorkspaceMenu))),
    height: 560,
    place: 'bottom-left',
    on: 'sidebar',
    // The workspace, not Credits (the row above it opens its own flyout).
    open: pressMenu(WORKSPACE)
  },
  'workspace-menu-hover': {
    component: defineComponent(() => () => h('div', { class: 'w-55' }, h(WorkspaceMenu))),
    height: 560,
    place: 'bottom-left',
    on: 'sidebar',
    open: pressMenu(WORKSPACE, 1)
  },
  'run-on-menu': {
    component: defineComponent(
      () => () =>
        h(
          'div',
          { class: 'mar-prompt-slot w-[560px]' },
          h(PromptBox, { target: true, class: 'mar-prompt' })
        )
    ),
    height: 600,
    place: 'top-center',
    open: pressMenu()
  },
  'build-switch': {
    component: defineComponent(() => () => [h(DesktopTitleBar), h(SwitcherMenu, { top: 44 })]),
    height: 420,
    place: 'top-left',
    on: 'bare',
    // The build pill opens it (tabs title bar); the breadcrumb's crumb did.
    open: (root) =>
      root.querySelector<HTMLElement>('header button[title="Where your work runs"]')?.click()
  },
  'credits-flyout': {
    component: defineComponent(() => () => h('div', { class: 'w-55' }, h(WorkspaceMenu))),
    height: 420,
    place: 'bottom-left',
    on: 'sidebar',
    open: (root) => root.querySelector<HTMLElement>('.mar-credits-row')?.click()
  },
  'layout-menu': {
    component: layoutMenu,
    height: 300,
    place: 'top-right',
    open: clickThen('.alm-trigger')
  },
  'layout-menu-sub': {
    component: layoutMenu,
    height: 300,
    place: 'top-right',
    open: clickThen('.alm-trigger', subOpen('Sort by'))
  },
  'item-menu': {
    component: itemMenu(TAG_LINES),
    height: 170,
    place: 'top-left',
    open: clickThen('.mar-kebab')
  },
  'item-menu-ask': {
    component: itemMenu(TAG_LINES),
    height: 170,
    place: 'top-left',
    open: clickThen('.mar-kebab', () =>
      document.querySelector<HTMLElement>('[role="menu"] .mar-menu-danger')?.click()
    )
  },
  'item-menu-card': {
    component: itemMenu(CARD_LINES),
    height: 220,
    place: 'top-left',
    open: clickThen('.mar-kebab')
  },
  'item-menu-sub': {
    component: itemMenu(CARD_LINES),
    height: 240,
    place: 'top-left',
    open: clickThen('.mar-kebab', subOpen('Move to project'))
  },
  'select-menu': {
    component: select,
    height: 190,
    place: 'top-left',
    open: (root) =>
      root
        .querySelector<HTMLElement>('button')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  },
  'tip-short': { component: tip('Notifications'), height: 110, open: focusTip },
  'tip-shortcut': { component: tip('Downloads (⌘⇧D)', Download), height: 110, open: focusTip },
  'tip-long': {
    component: tip('Not in a space yet. Add it to a space to share it with your team.'),
    height: 140,
    open: focusTip
  },
  'tip-draft': {
    component: defineComponent(
      () => () => h(DeployedTo, { kind: 'workflow', name: 'mar-ds-sample' })
    ),
    height: 90,
    open: focusTip
  }
} satisfies Record<string, StageDef>

export type StageId = keyof typeof STAGES
