import { onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import { MENU_REOPEN_GUARD_MS } from './useTitleBarMenus'

export type BuildMenu = 'install-switcher' | 'install-info'

interface MenuAnchor {
  x: number
  y: number
}

interface BuildMenusBridge {
  openBuildMenu: (menu: BuildMenu, anchor: MenuAnchor) => void
  dismissFileMenu: () => void
  onPopupHover: (cb: (inside: boolean) => void) => () => void
  onMenuOpened: (cb: (info: { menu: string; menuId?: string }) => void) => () => void
  onMenuClosed: (cb: (info: { menu: string }) => void) => () => void
}

/** Hover this long on the build's name before its card opens. */
export const INFO_OPEN_DELAY_MS = 350
/** Leave the name and the card this long before the card closes. */
export const INFO_CLOSE_DELAY_MS = 250

interface BuildMenusApi {
  /** The breadcrumb menu that is open, or null. */
  openMenu: Ref<BuildMenu | null>
  toggleSwitcher: (anchorEl: HTMLElement | null | undefined) => void
  onBuildEnter: (anchorEl: HTMLElement | null | undefined) => void
  onBuildLeave: () => void
  onBuildClick: (anchorEl: HTMLElement | null | undefined) => void
}

function isBuildMenu(menuId: string | undefined): menuId is BuildMenu {
  return menuId === 'install-switcher' || menuId === 'install-info'
}

function anchorBelow(el: HTMLElement | null | undefined): MenuAnchor {
  if (!el) return { x: 0, y: 0 }
  const rect = el.getBoundingClientRect()
  return { x: Math.round(rect.left), y: Math.round(rect.bottom) }
}

/**
 * The breadcrumb's two menus: the build switcher, toggled by the chevron, and
 * the build's info card, opened by hovering (or clicking) its name and kept
 * open while the pointer is on the name or the card. Both open in the
 * title-bar popup as menus; main echoes which one with each open. Hovering the
 * name does nothing while another title-bar popup is open.
 */
export function useBuildMenus(
  bridge: BuildMenusBridge | undefined,
  isOtherPopupOpen: () => boolean
): BuildMenusApi {
  const openMenu = ref<BuildMenu | null>(null)
  let closedAt = 0
  let pointerOnBuild = false
  /** A card opened by a click (or the keyboard) stays until it is dismissed. */
  let clickOpened = false
  let openTimer: ReturnType<typeof setTimeout> | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined

  function open(menu: BuildMenu, anchorEl: HTMLElement | null | undefined): void {
    bridge?.openBuildMenu(menu, anchorBelow(anchorEl))
  }

  function cancelTimers(): void {
    clearTimeout(openTimer)
    clearTimeout(closeTimer)
  }

  function scheduleInfoClose(): void {
    clearTimeout(closeTimer)
    closeTimer = setTimeout(() => {
      if (openMenu.value === 'install-info') bridge?.dismissFileMenu()
    }, INFO_CLOSE_DELAY_MS)
  }

  function toggleSwitcher(anchorEl: HTMLElement | null | undefined): void {
    cancelTimers()
    if (openMenu.value === 'install-switcher') {
      bridge?.dismissFileMenu()
      return
    }
    if (Date.now() - closedAt < MENU_REOPEN_GUARD_MS) return
    open('install-switcher', anchorEl)
  }

  const canOpenOnHover = (): boolean => !openMenu.value && !isOtherPopupOpen()

  function onBuildEnter(anchorEl: HTMLElement | null | undefined): void {
    pointerOnBuild = true
    cancelTimers()
    if (!canOpenOnHover()) return
    // Checked again when it fires: another popup may have opened meanwhile.
    openTimer = setTimeout(() => {
      if (canOpenOnHover()) open('install-info', anchorEl)
    }, INFO_OPEN_DELAY_MS)
  }

  function onBuildLeave(): void {
    pointerOnBuild = false
    clearTimeout(openTimer)
    if (openMenu.value === 'install-info' && !clickOpened) scheduleInfoClose()
  }

  function onBuildClick(anchorEl: HTMLElement | null | undefined): void {
    cancelTimers()
    if (openMenu.value === 'install-info') return
    // The click that dismissed the card must not reopen it.
    if (Date.now() - closedAt < MENU_REOPEN_GUARD_MS) return
    clickOpened = true
    open('install-info', anchorEl)
  }

  const unsubscribers: (() => void)[] = []
  onMounted(() => {
    if (!bridge) return
    unsubscribers.push(
      bridge.onMenuOpened(({ menu, menuId }) => {
        if (menu !== 'menu') return
        openMenu.value = isBuildMenu(menuId) ? menuId : null
        // Opened after the pointer already moved on: close unless it reaches the card.
        if (openMenu.value === 'install-info' && !pointerOnBuild && !clickOpened) {
          scheduleInfoClose()
        }
      }),
      bridge.onMenuClosed(({ menu }) => {
        if (menu !== 'menu') return
        if (openMenu.value) closedAt = Date.now()
        openMenu.value = null
        clickOpened = false
        cancelTimers()
      }),
      bridge.onPopupHover((inside) => {
        if (openMenu.value !== 'install-info') return
        if (inside) clearTimeout(closeTimer)
        else if (!pointerOnBuild && !clickOpened) scheduleInfoClose()
      })
    )
  })
  onUnmounted(() => {
    cancelTimers()
    unsubscribers.forEach((unsubscribe) => unsubscribe())
  })

  return { openMenu, toggleSwitcher, onBuildEnter, onBuildLeave, onBuildClick }
}
