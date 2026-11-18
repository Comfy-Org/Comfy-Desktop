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

const STORAGE_SECTIONS = [
  {
    fields: [
      field('useSharedModels', 'Use Shared Models', { value: true, editType: 'boolean' }),
      field('useSharedInput', 'Use Shared Input', { value: false, editType: 'boolean' }),
      field('useSharedOutput', 'Use Shared Output', { value: false, editType: 'boolean' }),
      field('modelDirs', 'Model Directories', { value: [], editType: 'model-dirs' }),
      field('installModelsDir', 'installModelsDir', { value: LONG_PATH, editType: 'hidden' }),
      field('inputDir', 'Input Folder', { value: LONG_PATH, editType: 'path' }),
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
        sharedDirectoriesFields: [],
        modelsDirs: [{ path: LONG_PATH, isPrimary: true }],
        modelsSystemDefault: LONG_PATH
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

const LAUNCH_SECTION: DetailSection = {
  title: 'Launch Settings',
  fields: [
    field('launchArgs', 'Startup arguments'),
    field('managerSecurityLevel', 'Manager Security Level', { rowGroup: 'manager' }),
    field('managerNetworkMode', 'Manager Network Mode', { rowGroup: 'manager' }),
    field('launchMode', 'Launch Mode', { rowGroup: 'launch-window' }),
    field('browserPartition', 'Browser Cache', { rowGroup: 'launch-window' }),
    field('portConflict', 'If Port is Busy')
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
    const sections = [...root.querySelectorAll<HTMLElement>('.build-settings-section')]
    expect(sections).toHaveLength(3)
    for (const section of sections) {
      const head = section.querySelector('.build-settings-head')!.getBoundingClientRect()
      const body = section.querySelector('.build-settings-body')!.getBoundingClientRect()
      expect(head.bottom, 'title sits above the folders').toBeLessThanOrEqual(body.top)
      expect(Math.round(body.left), 'folders start under the title').toBe(Math.round(head.left))
    }
  })

  it('shows every folder path in full, wrapping instead of truncating', async () => {
    const root = await mountStorage(width)
    const paths = [...root.querySelectorAll<HTMLElement>('.models-dir-name, .storage-dir-name')]
    expect(paths.length).toBeGreaterThanOrEqual(3)
    for (const path of paths) {
      expect(path.textContent?.trim()).toBe(LONG_PATH)
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
})
