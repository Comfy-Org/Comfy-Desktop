import { defineComponent, h, type Component } from 'vue'
import { Bell, Download } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Tooltip from '../../ui/Tooltip.vue'
import CreateMenu from '../CreateMenu.vue'
import WorkspaceMenu from '../../parts/WorkspaceMenu.vue'
import PromptBox from '../../parts/PromptBox.vue'
import DesktopTitleBar from '../../parts/DesktopTitleBar.vue'
import SwitcherMenu from '../../parts/nav/SwitcherMenu.vue'
import DeployedTo from '../../parts/space/DeployedTo.vue'
import AssetViewMenu from '../assets/AssetViewMenu.vue'

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
    height: 400,
    place: 'bottom-left',
    on: 'sidebar',
    // The workspace, not Credits (the row above it opens its own flyout).
    open: pressMenu(WORKSPACE)
  },
  'workspace-menu-hover': {
    component: defineComponent(() => () => h('div', { class: 'w-55' }, h(WorkspaceMenu))),
    height: 400,
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
    open: (root) => {
      const b = [...root.querySelectorAll<HTMLElement>('header button')].find((el) =>
        el.textContent?.includes('Open a build')
      )
      b?.click()
    }
  },
  'credits-flyout': {
    component: defineComponent(() => () => h('div', { class: 'w-55' }, h(WorkspaceMenu))),
    height: 420,
    place: 'bottom-left',
    on: 'sidebar',
    open: (root) => root.querySelector<HTMLElement>('.mar-credits-row')?.click()
  },
  'view-menu': {
    component: defineComponent(
      () => () =>
        h(
          'div',
          { class: 'mar-page is-embedded' },
          h('div', { class: 'mar-page-bar' }, h(AssetViewMenu))
        )
    ),
    height: 440,
    place: 'top-right',
    open: (root) => root.querySelector<HTMLElement>('.mar-view-trigger')?.click()
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
