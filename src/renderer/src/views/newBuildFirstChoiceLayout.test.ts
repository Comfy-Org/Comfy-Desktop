import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage } from 'vitest/browser'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import '../assets/main.css'
import InstallWizardModal from './InstallWizardModal.vue'
import { useModal } from '../composables/useModal'

const LONG = 'A very long name for a way to get ComfyUI that keeps going and going'

const SOURCES = [
  {
    id: 'standalone',
    label: 'Standalone',
    fields: [{ id: 'release', label: 'Release', type: 'select' }]
  },
  { id: 'portable', label: LONG, description: LONG, fields: [] },
  {
    id: 'remote',
    label: 'Remote Connection',
    skipInstall: true,
    fields: [{ id: 'url', label: 'Server URL', type: 'text' }]
  }
]

interface Box {
  left: number
  top: number
  width: number
  height: number
}

function installApi(): void {
  window.api = {
    platform: 'win32',
    openPath: vi.fn().mockResolvedValue(undefined),
    detectGPU: vi.fn().mockResolvedValue({ label: 'NVIDIA GeForce RTX 4090' }),
    getDefaultInstallDir: vi.fn().mockResolvedValue('C:\\Users\\alex\\ComfyUI'),
    getSources: vi.fn().mockResolvedValue(SOURCES),
    getFieldOptions: vi.fn().mockResolvedValue([{ value: 'stable', label: 'Stable' }]),
    validateHardware: vi.fn().mockResolvedValue({ supported: true }),
    getSetting: vi.fn().mockResolvedValue(false),
    onSettingsChanged: vi.fn(() => () => {}),
    getInstallationsSummary: vi.fn().mockResolvedValue({ localCount: 0 }),
    getUniqueName: vi.fn().mockResolvedValue('ComfyUI'),
    getDiskSpace: vi.fn().mockResolvedValue({ free: 412_000_000_000, total: 1_000_000_000_000 }),
    validateInstallPath: vi.fn().mockResolvedValue([]),
    getInstallations: vi.fn().mockResolvedValue([]),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {}),
    comfybuilder: {
      getAuthStatus: vi.fn().mockResolvedValue({ signedIn: false }),
      onAuthChanged: vi.fn(() => () => {}),
      listWorkspaces: vi.fn().mockResolvedValue([]),
      listBuilds: vi.fn().mockResolvedValue([])
    }
  } as unknown as typeof window.api
}

function only(selector: string): HTMLElement {
  const element = document.body.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`nothing matches ${selector}`)
  return element
}

function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect()
  const round = (value: number): number => Math.round(value * 100) / 100
  return {
    left: round(rect.left),
    top: round(rect.top),
    width: round(rect.width),
    height: round(rect.height)
  }
}

function cardRow(): HTMLElement {
  return only('[data-testid="install-source-tabs"]')
}

function cards(): HTMLElement[] {
  return [...cardRow().querySelectorAll<HTMLElement>('[role="radio"]')]
}

function rowShape(): { row: Box; cards: Box[] } {
  return { row: boxOf(cardRow()), cards: cards().map(boxOf) }
}

function inPanel(box: Box): Box {
  const panel = boxOf(only('.setup-modal-panel'))
  return { ...box, left: box.left - panel.left, top: box.top - panel.top }
}

function rowShapeInPanel(): { row: Box; cards: Box[] } {
  const { row, cards: cardBoxes } = rowShape()
  return { row: inPanel(row), cards: cardBoxes.map(inPanel) }
}

function formRowLabels(): string[] {
  return [...document.body.querySelectorAll('.config-change-form .setup-form-row')].map(
    (row) => row.querySelector('.config-label')?.textContent?.trim() ?? ''
  )
}

async function finishEntranceAnimations(): Promise<void> {
  const finite = document
    .getAnimations()
    .filter((animation) => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))
  await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)))
}

async function openChangeSetup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(InstallWizardModal, {
    attachTo: document.body,
    global: { plugins: [pinia] }
  })
  await wrapper.vm.open({})
  await flushPromises()
  only('[data-testid="config-change-setup"]').click()
  await flushPromises()
  await finishEntranceAnimations()
  return wrapper
}

async function pick(testId: string): Promise<void> {
  only(`[data-testid="${testId}"]`).click()
  await flushPromises()
}

beforeEach(() => {
  useModal().dismiss()
  installApi()
})

afterAll(() => browserPage.viewport(1100, 860))

describe('the first choice of New Build', () => {
  it.each([
    [1100, 860],
    [720, 860],
    [480, 860]
  ])(
    'keeps every card the same size inside its row at %ipx, whatever the label length',
    async (width, height) => {
      await browserPage.viewport(width, height)
      const wrapper = await openChangeSetup()

      const row = cardRow()
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
      const { row: rowBox, cards: cardBoxes } = rowShape()
      expect(cardBoxes).toHaveLength(6)
      for (const card of cardBoxes) {
        expect(card.width).toBe(cardBoxes[0]!.width)
        expect(card.height).toBe(cardBoxes[0]!.height)
        expect(card.left).toBeGreaterThanOrEqual(rowBox.left)
        expect(card.left + card.width).toBeLessThanOrEqual(rowBox.left + rowBox.width + 0.01)
      }
      for (const card of cards()) {
        const label = card.querySelector<HTMLElement>('.setup-option__label > .truncate')!
        expect(label.getBoundingClientRect().right).toBeLessThanOrEqual(
          card.getBoundingClientRect().right
        )
      }
      wrapper.unmount()
    }
  )

  it('keeps the shape of the card row in the dialog and drops the install rows when a build import card is picked', async () => {
    await browserPage.viewport(1100, 860)
    const wrapper = await openChangeSetup()
    const settled = rowShapeInPanel()
    expect(formRowLabels()).toEqual(['Get ComfyUI from', 'Release', 'Location'])

    for (const testId of ['install-source-add-existing', 'install-source-load-snapshot']) {
      await pick(testId)
      expect(rowShapeInPanel()).toEqual(settled)
      expect(formRowLabels()).toEqual(['Get ComfyUI from'])
      expect(document.body.querySelector('#source-fields')).toBeNull()
      expect(document.body.querySelector('[data-testid="install-location-field"]')).toBeNull()
    }

    await pick('install-source-remote')
    expect(rowShapeInPanel()).toEqual(settled)
    expect(formRowLabels()).toEqual(['Get ComfyUI from', 'Server URL'])

    await pick('install-source-standalone')
    expect(rowShapeInPanel()).toEqual(settled)
    expect(formRowLabels()).toEqual(['Get ComfyUI from', 'Release', 'Location'])
    wrapper.unmount()
  })
})
