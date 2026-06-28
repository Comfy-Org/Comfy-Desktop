import { Menu, clipboard, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import * as i18n from './i18n'

export interface ContextMenuHooks {
  /** Fired right before the native menu is shown. Used by auto-dismissing
   *  popups to suspend blur-dismiss so the menu doesn't close its own host. */
  onMenuOpen?: () => void
  /** Fired once the native menu closes (selection made or dismissed). */
  onMenuClose?: () => void
}

/** Actions wired to the menu items; injected so the builder stays pure/testable. */
export interface ContextMenuActions {
  saveImage: (srcURL: string) => void
  copyImage: () => void
  openLink: (linkURL: string) => void
  copyLink: (linkURL: string) => void
}

/** Subset of Electron's context-menu params the builder reads. */
export type ContextMenuParams = Pick<
  Electron.ContextMenuParams,
  'editFlags' | 'isEditable' | 'selectionText' | 'linkURL' | 'mediaType' | 'srcURL' | 'hasImageContents'
>

/**
 * Build the context-menu template for a right-click. Returns an empty array
 * when nothing is actionable so callers can skip popping an empty menu.
 *
 * Images get Save/Copy entries so right-clicking an output image (including
 * the fullscreen viewer) matches the browser's native "Save image" — the
 * launcher overrides Chromium's default menu, so without this there is no
 * way to save an image in-app.
 */
export function buildContextMenuItems(
  params: ContextMenuParams,
  actions: ContextMenuActions,
): Electron.MenuItemConstructorOptions[] {
  const { editFlags, isEditable, selectionText, linkURL, mediaType, srcURL, hasImageContents } = params
  const hasSelection = selectionText.trim().length > 0
  const hasLink = linkURL.length > 0
  const hasImage = mediaType === 'image' && hasImageContents && srcURL.length > 0

  const menuItems: Electron.MenuItemConstructorOptions[] = []

  if (hasLink) {
    menuItems.push(
      { id: 'openLink', label: i18n.t('contextMenu.openLinkInBrowser'), click: () => actions.openLink(linkURL) },
      { id: 'copyLink', label: i18n.t('contextMenu.copyLinkAddress'), click: () => actions.copyLink(linkURL) },
    )
  }

  if (hasImage) {
    if (menuItems.length > 0) menuItems.push({ type: 'separator' })
    menuItems.push(
      { id: 'saveImage', label: i18n.t('contextMenu.saveImage'), click: () => actions.saveImage(srcURL) },
      { id: 'copyImage', label: i18n.t('contextMenu.copyImage'), click: () => actions.copyImage() },
    )
  }

  if ((hasLink || hasImage) && (isEditable || hasSelection)) {
    menuItems.push({ type: 'separator' })
  }

  if (isEditable) {
    menuItems.push(
      { label: i18n.t('contextMenu.cut'), role: 'cut', enabled: editFlags.canCut },
      { label: i18n.t('contextMenu.copy'), role: 'copy', enabled: editFlags.canCopy },
      { label: i18n.t('contextMenu.paste'), role: 'paste', enabled: editFlags.canPaste },
      { type: 'separator' },
      { label: i18n.t('contextMenu.selectAll'), role: 'selectAll', enabled: editFlags.canSelectAll },
    )
  } else if (hasSelection) {
    menuItems.push(
      { label: i18n.t('contextMenu.copy'), role: 'copy', enabled: editFlags.canCopy },
      { label: i18n.t('contextMenu.selectAll'), role: 'selectAll', enabled: editFlags.canSelectAll },
    )
  }

  return menuItems
}

export function attachContextMenu(
  comfyWindow: BrowserWindow,
  webContents?: Electron.WebContents,
  hooks?: ContextMenuHooks,
): void {
  const wc = webContents || comfyWindow.webContents
  wc.on('context-menu', (_event, params) => {
    const menuItems = buildContextMenuItems(params, {
      // Route through the comfy view's session so the save flows through the
      // launcher's downloads tray (see attachSessionDownloadHandler).
      saveImage: (srcURL) => wc.session.downloadURL(srcURL),
      copyImage: () => wc.copyImageAt(params.x, params.y),
      openLink: (linkURL) => shell.openExternal(linkURL),
      copyLink: (linkURL) => clipboard.writeText(linkURL),
    })

    if (menuItems.length === 0) return

    hooks?.onMenuOpen?.()
    Menu.buildFromTemplate(menuItems).popup({
      window: comfyWindow,
      callback: () => hooks?.onMenuClose?.(),
    })
  })
}
