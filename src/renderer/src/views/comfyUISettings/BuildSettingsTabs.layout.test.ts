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
    selectField('portConflict', 'If Port is Busy')
  ]
}

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

  it('shares one left edge for folder icons, paths and Add Directory', async () => {
    const root = await mountStorage(width)
    const icons = rects(root, '.storage-item-icon')
    const paths = rects(root, '.models-dir-name, .storage-dir-name')
    const addIcon = root.querySelector('.models-dir-add svg')!.getBoundingClientRect()
    const addLabel = root.querySelector('.models-dir-add span')!.getBoundingClientRect()
    expectSame([...icons.map((r) => r.left), addIcon.left], 'icons share a left edge')
    expectSame(
      [...paths.map((r) => r.left), addLabel.left],
      'paths and Add Directory share a left edge'
    )
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

  it('gives each startup setting its own full-width row under the section title', async () => {
    const root = await mountStartupArgs(width)
    const head = root.querySelector('.settings-v2-section-head')!.getBoundingClientRect()
    const fields = [...root.querySelectorAll<HTMLElement>('.settings-v2-field')].map((el) =>
      el.getBoundingClientRect()
    )
    expect(fields).toHaveLength(LAUNCH_SECTION.fields!.length)
    expect(head.bottom, 'title sits above the settings').toBeLessThanOrEqual(fields[0]!.top)
    for (const [i, rect] of fields.entries()) {
      expect(Math.round(rect.left), `row ${i} starts at the same edge`).toBe(Math.round(head.left))
      expect(Math.round(rect.width), `row ${i} has the same width`).toBe(
        Math.round(fields[0]!.width)
      )
      if (i > 0)
        expect(rect.top, `row ${i} sits below the one before`).toBeGreaterThan(fields[i - 1]!.top)
    }
  })

  it('spaces startup settings like Desktop Settings fields', async () => {
    const root = await mountStartupArgs(width)
    const fields = [...root.querySelectorAll<HTMLElement>('.settings-v2-field')]
    const labelGaps = fields.map((el) => {
      const label = el.querySelector('.settings-v2-field-label')!.getBoundingClientRect()
      const control = el.querySelector(CONTROL)!.getBoundingClientRect()
      return control.top - label.bottom
    })
    const rowGaps = fields
      .slice(1)
      .map((el, i) => el.getBoundingClientRect().top - fields[i]!.getBoundingClientRect().bottom)
    expectSame(labelGaps, 'label to field gap is even')
    expectSame(rowGaps, 'field to next label gap is even')
    expect(Math.round(labelGaps[0]!), 'label sits 4px above its field').toBe(4)
    expect(Math.round(rowGaps[0]!), 'fields sit 4px apart').toBe(4)
    for (const control of root.querySelectorAll<HTMLElement>(CONTROL)) {
      expect(Math.round(control.getBoundingClientRect().height), 'field height').toBe(40)
      expect(getComputedStyle(control).borderRadius, 'field radius').toBe('8px')
    }
  })
})
