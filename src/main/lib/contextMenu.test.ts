import { Menu, shell } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  Menu: { buildFromTemplate: vi.fn() },
  clipboard: { writeText: vi.fn() },
  shell: { openExternal: vi.fn() }
}))

vi.mock('./i18n', () => ({
  t: (key: string) => key
}))

import {
  attachContextMenu,
  buildContextMenuItems,
  type ContextMenuActions,
  type ContextMenuParams
} from './contextMenu'

const noopActions: ContextMenuActions = {
  saveImage: vi.fn(),
  copyImage: vi.fn(),
  openLink: vi.fn(),
  copyLink: vi.fn(),
  replaceMisspelling: vi.fn(),
  addWordToDictionary: vi.fn()
}

function makeParams(overrides: Partial<ContextMenuParams> = {}): ContextMenuParams {
  return {
    editFlags: {
      canCut: false,
      canCopy: false,
      canPaste: false,
      canSelectAll: false
    } as Electron.ContextMenuParams['editFlags'],
    isEditable: false,
    selectionText: '',
    linkURL: '',
    mediaType: 'none',
    srcURL: '',
    hasImageContents: false,
    misspelledWord: '',
    dictionarySuggestions: [],
    ...overrides
  }
}

const ids = (items: Electron.MenuItemConstructorOptions[]): string[] =>
  items.map((i) => i.id ?? i.type ?? i.role).filter((x): x is string => typeof x === 'string')

describe('buildContextMenuItems', () => {
  it('returns no items when nothing is actionable', () => {
    expect(buildContextMenuItems(makeParams(), noopActions)).toEqual([])
  })

  it('adds spelling suggestions before editable actions', () => {
    const items = buildContextMenuItems(
      makeParams({
        isEditable: true,
        misspelledWord: 'relaly',
        dictionarySuggestions: ['really', 'relay']
      }),
      noopActions
    )

    expect(items.map((item) => item.label ?? item.type ?? item.role)).toEqual([
      'really',
      'relay',
      'separator',
      'contextMenu.addToDictionary',
      'separator',
      'contextMenu.cut',
      'contextMenu.copy',
      'contextMenu.paste',
      'separator',
      'contextMenu.selectAll'
    ])
  })

  it('wires spelling suggestions and dictionary additions to their actions', () => {
    const actions: ContextMenuActions = {
      ...noopActions,
      replaceMisspelling: vi.fn(),
      addWordToDictionary: vi.fn()
    }
    const items = buildContextMenuItems(
      makeParams({ misspelledWord: 'relaly', dictionarySuggestions: ['really'] }),
      actions
    )

    ;(items[0]!.click as () => void)()
    ;(items[2]!.click as () => void)()

    expect(actions.replaceMisspelling).toHaveBeenCalledWith('really')
    expect(actions.addWordToDictionary).toHaveBeenCalledWith('relaly')
  })

  it('offers adding a misspelling when there are no suggestions', () => {
    const items = buildContextMenuItems(
      makeParams({ misspelledWord: 'qzqx', dictionarySuggestions: [] }),
      noopActions
    )

    expect(items.map((item) => item.label ?? item.type)).toEqual(['contextMenu.addToDictionary'])
  })

  it('adds Save/Copy image entries for an image with contents', () => {
    const items = buildContextMenuItems(
      makeParams({ mediaType: 'image', hasImageContents: true, srcURL: 'http://x/y.png' }),
      noopActions
    )
    expect(ids(items)).toEqual(['saveImage', 'copyImage'])
  })

  it('ignores images without contents or src', () => {
    expect(
      buildContextMenuItems(
        makeParams({ mediaType: 'image', hasImageContents: false, srcURL: 'http://x/y.png' }),
        noopActions
      )
    ).toEqual([])
    expect(
      buildContextMenuItems(
        makeParams({ mediaType: 'image', hasImageContents: true, srcURL: '' }),
        noopActions
      )
    ).toEqual([])
  })

  it('wires Save Image to the action with the srcURL', () => {
    const actions: ContextMenuActions = { ...noopActions, saveImage: vi.fn() }
    const items = buildContextMenuItems(
      makeParams({ mediaType: 'image', hasImageContents: true, srcURL: 'http://x/y.png' }),
      actions
    )
    const save = items.find((i) => i.id === 'saveImage')
    ;(save?.click as () => void)?.()
    expect(actions.saveImage).toHaveBeenCalledWith('http://x/y.png')
  })

  it('separates link and image blocks', () => {
    const items = buildContextMenuItems(
      makeParams({
        linkURL: 'http://x',
        mediaType: 'image',
        hasImageContents: true,
        srcURL: 'http://x/y.png'
      }),
      noopActions
    )
    expect(ids(items)).toEqual(['openLink', 'copyLink', 'separator', 'saveImage', 'copyImage'])
  })

  it('separates an image block from editable items', () => {
    const items = buildContextMenuItems(
      makeParams({
        mediaType: 'image',
        hasImageContents: true,
        srcURL: 'http://x/y.png',
        isEditable: true
      }),
      noopActions
    )
    expect(ids(items)).toEqual([
      'saveImage',
      'copyImage',
      'separator',
      'cut',
      'copy',
      'paste',
      'separator',
      'selectAll'
    ])
  })

  it('shows copy/select-all for a plain text selection', () => {
    const items = buildContextMenuItems(makeParams({ selectionText: 'hello' }), noopActions)
    expect(ids(items)).toEqual(['copy', 'selectAll'])
  })
})

describe('right-clicking a link in a page', () => {
  function rightClick(linkURL: string): Electron.MenuItemConstructorOptions[] {
    const listeners = new Map<string, (event: unknown, params: ContextMenuParams) => void>()
    const contents = {
      on: (name: string, listener: (event: unknown, params: ContextMenuParams) => void) =>
        listeners.set(name, listener)
    } as unknown as WebContents
    vi.mocked(Menu.buildFromTemplate).mockReturnValue({ popup: vi.fn() } as unknown as Menu)
    attachContextMenu({} as BrowserWindow, contents)
    listeners.get('context-menu')!({}, makeParams({ linkURL }))
    return vi
      .mocked(Menu.buildFromTemplate)
      .mock.calls.at(-1)![0] as Electron.MenuItemConstructorOptions[]
  }

  beforeEach(() => {
    vi.mocked(Menu.buildFromTemplate).mockReset()
    vi.mocked(shell.openExternal).mockReset()
  })

  it('Open link hands a web link to the OS', () => {
    const openLink = rightClick('https://comfy.org/docs').find((item) => item.id === 'openLink')

    ;(openLink!.click as () => void)()

    expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith('https://comfy.org/docs')
  })

  it.each([
    'file:///etc/passwd',
    'file://attacker.example/share/payload.exe',
    'smb://attacker.example/share',
    'search-ms:query=invoice'
  ])('offers only Copy link address for %j', (linkURL) => {
    expect(ids(rightClick(linkURL))).toEqual(['copyLink'])
  })
})
