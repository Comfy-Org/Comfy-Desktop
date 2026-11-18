import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import '../../assets/main.css'
import StoragePane from './StoragePane.vue'
import SettingsSectionList from './SettingsSectionList.vue'
import type { DetailField, DetailSection } from '../../types/ipc'

const LONG_PATH = `C:\\Users\\someone\\AppData\\Local\\Comfy-Desktop\\${'ComfyUI-Shared-Folder\\'.repeat(6)}models`
const WIDTHS = { wide: 1100, narrow: 480 }

const mounted: VueWrapper[] = []

afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount())
  document.body.innerHTML = ''
})

function host(width: number): HTMLElement {
  const el = document.createElement('div')
  el.style.width = `${width}px`
  document.body.appendChild(el)
  return el
}

function field(id: string, label: string, extra: Partial<DetailField> = {}): DetailField {
  return { id, label, value: '', editable: true, editType: 'text', ...extra }
}

const SHARED_MODELS = 'D:\\Comfy\\shared\\models'
const SHORT_PATH = 'E:\\extra\\models'

const STORAGE_SECTIONS = [
  {
    fields: [
      field('useSharedModels', 'Use Shared Models', { value: true, editType: 'boolean' }),
      field('useSharedInput', 'Use Shared Input', { value: true, editType: 'boolean' }),
      field('useSharedOutput', 'Use Shared Output', { value: false, editType: 'boolean' }),
      field('modelDirs', 'Model Directories', { value: [SHORT_PATH], editType: 'model-dirs' }),
      field('installModelsDir', 'installModelsDir', { value: LONG_PATH, editType: 'hidden' }),
      field('outputDir', 'Output Folder', { value: LONG_PATH, editType: 'path' })
    ]
  }
] as unknown as DetailSection[]

async function mountStorage(width: number): Promise<HTMLElement> {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    platform: 'win32',
    browseFolder: async () => null,
    openPath: async () => undefined,
    revealPath: () => undefined,
    openGlobalSettings: () => undefined
  }
  const wrapper = mount(StoragePane, {
    props: {
      snapshot: {
        sharedDirectoriesFields: [field('inputDir', 'Input', { value: LONG_PATH })],
        modelsDirs: [{ path: SHARED_MODELS, isPrimary: true }],
        modelsSystemDefault: SHARED_MODELS
      },
      sections: STORAGE_SECTIONS,
      pendingRestartFieldIds: new Set<string>()
    },
    attachTo: host(width)
  })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper.element as HTMLElement
}

function rects(root: HTMLElement, selector: string): DOMRect[] {
  return [...root.querySelectorAll<HTMLElement>(selector)].map((el) => el.getBoundingClientRect())
}

function expectSame(values: number[], message: string): void {
  expect(values.length, message).toBeGreaterThan(1)
  for (const v of values) expect(Math.round(v), message).toBe(Math.round(values[0]!))
}

function selectField(id: string, label: string, rowGroup?: string): DetailField {
  return field(id, label, {
    editType: 'select',
    value: 'a',
    options: [{ value: 'a', label: 'Option A' }],
    rowGroup
  })
}

const CONTROL = '.ui-input, [role="combobox"]'

const LAUNCH_SECTION: DetailSection = {
  title: 'Launch Settings',
  fields: [
    field('launchArgs', 'Startup arguments', { editType: 'args-builder' }),
    selectField('managerSecurityLevel', 'Manager Security Level', 'manager'),
    selectField('managerNetworkMode', 'Manager Network Mode', 'manager'),
    selectField('launchMode', 'Launch Mode', 'launch-window'),
    selectField('browserPartition', 'Browser Cache', 'launch-window'),
    selectField('portConflict', 'If Port is Busy'),
    field('envVars', 'Environment Variables', {
      editType: 'env-vars',
      value: { HF_HOME: 'D:\\hf' }
    })
  ]
}

const CARD_FILL_PROBE = 'bg-card'

async function mountStartupArgs(width: number): Promise<HTMLElement> {
  const wrapper = mount(SettingsSectionList, {
    props: { sections: [LAUNCH_SECTION], stacked: true },
    attachTo: host(width)
  })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper.element as HTMLElement
}

describe.each(Object.entries(WIDTHS))('build settings tabs at %s width', (_name, width) => {
  it('stacks every Folders section title above its folders', async () => {
    const root = await mountStorage(width)
    const sections = [...root.querySelectorAll<HTMLElement>('.gs-micro-section')]
    expect(sections).toHaveLength(3)
    for (const section of sections) {
      const head = section.querySelector('.gs-micro-title')!.getBoundingClientRect()
      const body = section.querySelector('.gs-micro-body')!.getBoundingClientRect()
      expect(head.bottom, 'title sits above the folders').toBeLessThanOrEqual(body.top)
      expect(Math.round(body.left), 'folders start under the title').toBe(Math.round(head.left))
    }
  })

  it('ends every toggle on the right edge of its folder box', async () => {
    const root = await mountStorage(width)
    for (const section of root.querySelectorAll<HTMLElement>('.gs-micro-section')) {
      const toggle = section.querySelector('.bt-switch')!.getBoundingClientRect()
      const box = section.querySelector('.gs-micro-body > *')!.getBoundingClientRect()
      expect(Math.round(toggle.right), 'toggle ends on the box edge').toBe(Math.round(box.right))
    }
  })

  it('lines badges and actions up in one trailing column across sections', async () => {
    const root = await mountStorage(width)
    const actions = rects(root, '.models-dir-actions, .storage-dir-actions')
    expect(actions.length).toBeGreaterThanOrEqual(4)
    expectSame(
      actions.map((r) => r.right),
      'actions end at the same x'
    )
    expectSame(
      actions.map((r) => r.left),
      'action column starts at the same x'
    )
    const badgeGroups = [
      ...root.querySelectorAll<HTMLElement>('.models-dir-tags, .storage-dir-tags')
    ]
    expectSame(
      badgeGroups.map((g) => g.getBoundingClientRect().right),
      'badges end at the same x'
    )
  })

  it('shares one left edge for folder icons and one for paths', async () => {
    const root = await mountStorage(width)
    expectSame(
      rects(root, '.storage-item-icon').map((r) => r.left),
      'icons share a left edge'
    )
    expectSame(
      rects(root, '.models-dir-name, .storage-dir-name').map((r) => r.left),
      'paths share a left edge'
    )
  })

  it('gives every row the same trailing shape: badges, then one 28px more slot', async () => {
    const root = await mountStorage(width)
    const rows = [...root.querySelectorAll<HTMLElement>('.models-dir-row, .storage-dir-row')]
    expect(rows.length).toBeGreaterThanOrEqual(4)
    for (const row of rows) {
      const slot = row.querySelector('.models-dir-actions, .storage-dir-actions')!
      expect(Math.round(slot.getBoundingClientRect().width), 'one fixed action slot').toBe(28)
      const buttons = slot.querySelectorAll('button')
      expect(buttons.length, 'at most the more button').toBeLessThanOrEqual(1)
      for (const button of buttons) {
        expect(button.getAttribute('aria-label'), 'the slot holds only more').toBe('More actions')
      }
      const tags = row.querySelector('.models-dir-tags, .storage-dir-tags')
      if (!tags) continue
      expect(
        Math.round(slot.getBoundingClientRect().left - tags.getBoundingClientRect().right),
        'badges sit right before the slot'
      ).toBe(10)
    }
  })

  it('puts Add Directory as a + beside the Models title, not inside the box', async () => {
    const root = await mountStorage(width)
    const models = root.querySelector<HTMLElement>('.gs-micro-section')!
    const title = models.querySelector('.gs-micro-title > span')!.getBoundingClientRect()
    const add = models.querySelector('.gs-micro-title .storage-add-dir')!.getBoundingClientRect()
    const box = models.querySelector('.models-dir-list')!.getBoundingClientRect()
    expect(add.bottom, 'the + sits above the box').toBeLessThanOrEqual(box.top)
    expect(add.left, 'the + follows the title').toBeGreaterThan(title.right)
    expect(add.right, 'the + stays on the title side').toBeLessThan(box.left + box.width / 2)
    expect(
      Math.abs(add.top + add.height / 2 - (title.top + title.height / 2)),
      'the + is centred on the title'
    ).toBeLessThanOrEqual(1)
  })

  it('keeps icons and badges on the first line when a path wraps', async () => {
    const root = await mountStorage(width)
    const rows = [...root.querySelectorAll<HTMLElement>('.models-dir-row, .storage-dir-row')]
    for (const row of rows) {
      const name = row.querySelector('.models-dir-name, .storage-dir-name')!.getBoundingClientRect()
      const firstLineMiddle = name.top + 9
      const icon = row.querySelector('.storage-item-icon')!.getBoundingClientRect()
      expect(
        Math.abs(icon.top + icon.height / 2 - firstLineMiddle),
        'icon on the first line'
      ).toBeLessThanOrEqual(1)
      for (const tag of row.querySelectorAll<HTMLElement>('.storage-tag')) {
        const r = tag.getBoundingClientRect()
        expect(
          Math.abs(r.top + r.height / 2 - firstLineMiddle),
          'badge on the first line'
        ).toBeLessThanOrEqual(1)
      }
    }
    const listRows = rects(root, '.models-dir-row')
    const singleLine = listRows.filter((r) => Math.round(r.height) === 44)
    expect(singleLine.length, 'a one-line row keeps the 44px height').toBeGreaterThan(0)
  })

  it('shows every folder path in full, wrapping instead of truncating', async () => {
    const root = await mountStorage(width)
    const paths = [...root.querySelectorAll<HTMLElement>('.models-dir-name, .storage-dir-name')]
    expect(paths.length).toBeGreaterThanOrEqual(3)
    const longPaths = paths.filter((path) => path.textContent?.trim() === LONG_PATH)
    expect(longPaths.length, 'every long path is shown in full').toBe(3)
    for (const path of paths) {
      expect(path.scrollWidth, 'path is not clipped').toBeLessThanOrEqual(path.clientWidth + 1)
    }
    expect(root.scrollWidth, 'pane never scrolls sideways').toBeLessThanOrEqual(width)
  })

  it('pairs startup settings in two even columns under the full-width arguments field', async () => {
    const root = await mountStartupArgs(width)
    const head = root.querySelector('.settings-v2-section-head')!.getBoundingClientRect()
    const byId = (id: string) =>
      root.querySelector(`[data-field-id="${id}"]`)!.getBoundingClientRect()
    const args = byId('launchArgs')
    expect(head.bottom, 'title sits above the settings').toBeLessThanOrEqual(args.top)
    expect(Math.round(args.left), 'arguments start under the title').toBe(Math.round(head.left))
    const pairs = [
      ['managerSecurityLevel', 'managerNetworkMode'],
      ['launchMode', 'browserPartition']
    ].map(([a, b]) => [byId(a!), byId(b!)] as const)
    const twoColumns = width >= 768
    for (const [first, second] of pairs) {
      expect(Math.round(first.left), 'pair starts on the arguments edge').toBe(
        Math.round(args.left)
      )
      expect(Math.round(second.right), 'pair ends on the arguments edge').toBe(
        Math.round(args.right)
      )
      if (twoColumns) {
        expect(Math.round(second.top), 'pair shares one row').toBe(Math.round(first.top))
        expect(Math.round(second.width), 'pair columns are even').toBe(Math.round(first.width))
        expect(Math.round(second.left - first.right), 'pair gap').toBe(16)
      } else {
        expect(Math.round(first.width), 'narrow pairs stack full width').toBe(
          Math.round(args.width)
        )
        expect(second.top, 'narrow pair stacks').toBeGreaterThan(first.top)
      }
    }
    const port = byId('portConflict')
    expect(Math.round(port.left), 'last row starts on the arguments edge').toBe(
      Math.round(args.left)
    )
    expect(Math.round(port.width), 'last row spans the arguments width').toBe(
      Math.round(args.width)
    )
  })

  it('keeps each label close to its own field and clear of the field above', async () => {
    const root = await mountStartupArgs(width)
    const fields = [...root.querySelectorAll<HTMLElement>('.settings-v2-field:not(.is-env-vars)')]
    const labelGaps = fields.map((el) => {
      const label = el.querySelector('.settings-v2-field-label')!.getBoundingClientRect()
      const control = el.querySelector(CONTROL)!.getBoundingClientRect()
      return control.top - label.bottom
    })
    const rowTops = [...new Set(fields.map((el) => Math.round(el.getBoundingClientRect().top)))]
    const rowBottoms = rowTops.map((top) =>
      Math.max(
        ...fields
          .map((el) => el.getBoundingClientRect())
          .filter((r) => Math.round(r.top) === top)
          .map((r) => r.bottom)
      )
    )
    const rowGaps = rowTops.slice(1).map((top, i) => top - rowBottoms[i]!)
    expectSame(labelGaps, 'label to field gap is even')
    expectSame(rowGaps, 'field to next label gap is even')
    expect(Math.round(labelGaps[0]!), 'label sits 4px above its field').toBe(4)
    expect(Math.round(rowGaps[0]!), 'fields sit 16px apart').toBe(16)
    for (const control of root.querySelectorAll<HTMLElement>(CONTROL)) {
      expect(Math.round(control.getBoundingClientRect().height), 'field height').toBe(40)
      expect(getComputedStyle(control).borderRadius, 'field radius').toBe('8px')
    }
  })

  it('fills every folder box with the card surface used on Overview', async () => {
    const root = await mountStorage(width)
    const probe = document.createElement('div')
    probe.className = CARD_FILL_PROBE
    document.body.appendChild(probe)
    const cardFill = getComputedStyle(probe).backgroundColor
    const boxes = [...root.querySelectorAll<HTMLElement>('.gs-micro-body > *')]
    expect(boxes.length).toBeGreaterThanOrEqual(3)
    for (const box of boxes) {
      expect(getComputedStyle(box).backgroundColor, 'box fill').toBe(cardFill)
    }
  })

  it('keeps the environment variables title and note clear of the field above', async () => {
    const root = await mountStartupArgs(width)
    const env = root.querySelector<HTMLElement>('.settings-v2-field.is-env-vars')!
    const port = root.querySelector('[data-field-id="portConflict"]')!.getBoundingClientRect()
    const note = env.querySelector('.settings-v2-env-notice')!.getBoundingClientRect()
    const label = env.querySelector('.settings-v2-field-label')!.getBoundingClientRect()
    expect(Math.round(env.getBoundingClientRect().top - port.bottom), 'env block gap').toBe(16)
    expect(note.top, 'note stays below the field above').toBeGreaterThanOrEqual(
      env.getBoundingClientRect().top
    )
    expect(Math.round(label.top + label.height / 2), 'title and note share one line').toBe(
      Math.round(note.top + note.height / 2)
    )
  })
})
