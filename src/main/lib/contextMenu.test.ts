import { describe, expect, it, vi } from 'vitest'

// contextMenu.ts imports electron at module load; mock it before importing.
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: vi.fn() },
  clipboard: { writeText: vi.fn() },
  shell: { openExternal: vi.fn() },
}))

// i18n reads locale files off disk; keep labels deterministic and side-effect free.
vi.mock('./i18n', () => ({
  t: (key: string) => key,
}))

import { buildContextMenuItems, type ContextMenuActions, type ContextMenuParams } from './contextMenu'

const noopActions: ContextMenuActions = {
  saveImage: vi.fn(),
  copyImage: vi.fn(),
  openLink: vi.fn(),
  copyLink: vi.fn(),
}

function makeParams(overrides: Partial<ContextMenuParams> = {}): ContextMenuParams {
  return {
    editFlags: {
      canCut: false,
      canCopy: false,
      canPaste: false,
      canSelectAll: false,
    } as Electron.ContextMenuParams['editFlags'],
    isEditable: false,
    selectionText: '',
    linkURL: '',
    mediaType: 'none',
    srcURL: '',
    hasImageContents: false,
    ...overrides,
  }
}

const ids = (items: Electron.MenuItemConstructorOptions[]): string[] =>
  items.map((i) => i.id ?? i.type ?? i.role).filter((x): x is string => typeof x === 'string')

describe('buildContextMenuItems', () => {
  it('returns no items when nothing is actionable', () => {
    expect(buildContextMenuItems(makeParams(), noopActions)).toEqual([])
  })

  it('adds Save/Copy image entries for an image with contents', () => {
    const items = buildContextMenuItems(
      makeParams({ mediaType: 'image', hasImageContents: true, srcURL: 'http://x/y.png' }),
      noopActions,
    )
    expect(ids(items)).toEqual(['saveImage', 'copyImage'])
  })

  it('ignores images without contents or src', () => {
    expect(
      buildContextMenuItems(makeParams({ mediaType: 'image', hasImageContents: false, srcURL: 'http://x/y.png' }), noopActions),
    ).toEqual([])
    expect(
      buildContextMenuItems(makeParams({ mediaType: 'image', hasImageContents: true, srcURL: '' }), noopActions),
    ).toEqual([])
  })

  it('wires Save Image to the action with the srcURL', () => {
    const actions: ContextMenuActions = { ...noopActions, saveImage: vi.fn() }
    const items = buildContextMenuItems(
      makeParams({ mediaType: 'image', hasImageContents: true, srcURL: 'http://x/y.png' }),
      actions,
    )
    const save = items.find((i) => i.id === 'saveImage')
    ;(save?.click as () => void)?.()
    expect(actions.saveImage).toHaveBeenCalledWith('http://x/y.png')
  })

  it('separates link and image blocks', () => {
    const items = buildContextMenuItems(
      makeParams({ linkURL: 'http://x', mediaType: 'image', hasImageContents: true, srcURL: 'http://x/y.png' }),
      noopActions,
    )
    expect(ids(items)).toEqual(['openLink', 'copyLink', 'separator', 'saveImage', 'copyImage'])
  })

  it('separates an image block from editable items', () => {
    const items = buildContextMenuItems(
      makeParams({
        mediaType: 'image',
        hasImageContents: true,
        srcURL: 'http://x/y.png',
        isEditable: true,
      }),
      noopActions,
    )
    expect(ids(items)).toEqual([
      'saveImage',
      'copyImage',
      'separator',
      'cut',
      'copy',
      'paste',
      'separator',
      'selectAll',
    ])
  })

  it('shows copy/select-all for a plain text selection', () => {
    const items = buildContextMenuItems(makeParams({ selectionText: 'hello' }), noopActions)
    expect(ids(items)).toEqual(['copy', 'selectAll'])
  })
})
