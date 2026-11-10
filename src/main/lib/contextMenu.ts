import { Menu, clipboard, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import * as i18n from './i18n'

export interface ContextMenuHooks {
  onMenuOpen?: () => void
  onMenuClose?: () => void
}

export interface ContextMenuActions {
  saveImage: (srcURL: string) => void
  copyImage: () => void
  openLink: (linkURL: string) => void
  copyLink: (linkURL: string) => void
  replaceMisspelling: (suggestion: string) => void
  addWordToDictionary: (word: string) => void
}

export type ContextMenuParams = Pick<
  Electron.ContextMenuParams,
  | 'editFlags'
  | 'isEditable'
  | 'selectionText'
  | 'linkURL'
  | 'mediaType'
  | 'srcURL'
  | 'hasImageContents'
  | 'misspelledWord'
  | 'dictionarySuggestions'
>

export function buildContextMenuItems(
  params: ContextMenuParams,
  actions: ContextMenuActions
): Electron.MenuItemConstructorOptions[] {
  const {
    editFlags,
    isEditable,
    selectionText,
    linkURL,
    mediaType,
    srcURL,
    hasImageContents,
    misspelledWord,
    dictionarySuggestions
  } = params
  const hasSelection = selectionText.trim().length > 0
  const hasLink = linkURL.length > 0
  const hasImage = mediaType === 'image' && hasImageContents && srcURL.length > 0
  const hasMisspelling = misspelledWord.length > 0

  const menuItems: Electron.MenuItemConstructorOptions[] = []

  if (hasMisspelling) {
    menuItems.push(
      ...dictionarySuggestions.map((suggestion) => ({
        label: suggestion,
        click: () => actions.replaceMisspelling(suggestion)
      }))
    )
    if (dictionarySuggestions.length > 0) menuItems.push({ type: 'separator' })
    menuItems.push({
      label: i18n.t('contextMenu.addToDictionary'),
      click: () => actions.addWordToDictionary(misspelledWord)
    })
  }

  if (hasLink) {
    if (menuItems.length > 0) menuItems.push({ type: 'separator' })
    menuItems.push(
      {
        id: 'openLink',
        label: i18n.t('contextMenu.openLinkInBrowser'),
        click: () => actions.openLink(linkURL)
      },
      {
        id: 'copyLink',
        label: i18n.t('contextMenu.copyLinkAddress'),
        click: () => actions.copyLink(linkURL)
      }
    )
  }

  if (hasImage) {
    if (menuItems.length > 0) menuItems.push({ type: 'separator' })
    menuItems.push(
      {
        id: 'saveImage',
        label: i18n.t('contextMenu.saveImage'),
        click: () => actions.saveImage(srcURL)
      },
      { id: 'copyImage', label: i18n.t('contextMenu.copyImage'), click: () => actions.copyImage() }
    )
  }

  if (menuItems.length > 0 && (isEditable || hasSelection)) {
    menuItems.push({ type: 'separator' })
  }

  if (isEditable) {
    menuItems.push(
      { label: i18n.t('contextMenu.cut'), role: 'cut', enabled: editFlags.canCut },
      { label: i18n.t('contextMenu.copy'), role: 'copy', enabled: editFlags.canCopy },
      { label: i18n.t('contextMenu.paste'), role: 'paste', enabled: editFlags.canPaste },
      { type: 'separator' },
      { label: i18n.t('contextMenu.selectAll'), role: 'selectAll', enabled: editFlags.canSelectAll }
    )
  } else if (hasSelection) {
    menuItems.push(
      { label: i18n.t('contextMenu.copy'), role: 'copy', enabled: editFlags.canCopy },
      { label: i18n.t('contextMenu.selectAll'), role: 'selectAll', enabled: editFlags.canSelectAll }
    )
  }

  return menuItems
}

export function attachContextMenu(
  comfyWindow: BrowserWindow,
  webContents?: Electron.WebContents,
  hooks?: ContextMenuHooks
): void {
  const wc = webContents || comfyWindow.webContents
  wc.on('context-menu', (_event, params) => {
    const menuItems = buildContextMenuItems(params, {
      saveImage: (srcURL) => wc.session.downloadURL(srcURL),
      copyImage: () => wc.copyImageAt(params.x, params.y),
      openLink: (linkURL) => shell.openExternal(linkURL),
      copyLink: (linkURL) => clipboard.writeText(linkURL),
      replaceMisspelling: (suggestion) => wc.replaceMisspelling(suggestion),
      addWordToDictionary: (word) => wc.session.addWordToSpellCheckerDictionary(word)
    })

    if (menuItems.length === 0) return

    hooks?.onMenuOpen?.()
    Menu.buildFromTemplate(menuItems).popup({
      window: comfyWindow,
      callback: () => hooks?.onMenuClose?.()
    })
  })
}
