import { afterEach, describe, expect, it, vi } from 'vitest'
import { page as browserPage } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import '../assets/main.css'
import LoadSnapshotModal from './LoadSnapshotModal.vue'

const preview = {
  filePath: '/Users/ada/Downloads/studio-snapshot.json',
  installationName: 'Studio',
  snapshotCount: 3,
  snapshots: [],
  newestSnapshot: {
    comfyuiVersion: 'v0.4.2',
    pythonVersion: '3.12',
    createdAt: '2026-11-01T10:00:00Z',
    updateChannel: 'stable',
    comfyui: { variant: 'mps', releaseTag: '' },
    customNodes: [],
    pipPackages: {},
    pipPackageCount: 0
  }
}

function installApi(): void {
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    previewSnapshotFile: vi.fn().mockResolvedValue({ ok: true, preview }),
    detectGPU: vi.fn().mockResolvedValue(null),
    revealPath: vi.fn(),
    getPathForFile: vi.fn(),
    getFieldOptions: vi.fn(async (_source: string, fieldId: string) =>
      fieldId === 'release'
        ? [{ value: 'stable', label: 'Stable' }]
        : [
            {
              value: 'mps',
              label: 'Apple Silicon (MPS)',
              recommended: true,
              data: { variantId: 'mps' }
            },
            { value: 'cpu', label: 'CPU', data: { variantId: 'cpu' } }
          ]
    )
  }
}

let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

async function settle(): Promise<void> {
  await flushPromises()
  await document.fonts.ready
  for (const animation of document.getAnimations()) animation.finish()
  await flushPromises()
}

async function openModal(): Promise<void> {
  installApi()
  await browserPage.viewport(1100, 900)
  document.documentElement.dataset.theme = 'dark'
  wrapper = mount(LoadSnapshotModal, { attachTo: document.body })
  ;(wrapper.vm as unknown as { open: () => void }).open()
  await settle()
}

function rect(selector: string): DOMRect {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`missing ${selector}`)
  return el.getBoundingClientRect()
}

function firstTextLeft(el: Element): number {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (!node.textContent?.trim()) continue
    const range = document.createRange()
    range.selectNodeContents(node)
    return range.getClientRects()[0].left
  }
  throw new Error('no text')
}

describe('Load snapshot layout', () => {
  it('keeps 20px between the drop zone and the footer line', async () => {
    await openModal()
    const gap = rect('.setup-modal-foot').top - rect('.load-snapshot-dropzone').bottom
    expect(Math.round(gap)).toBe(20)
  })

  it('keeps 20px between the last block and the footer line once a file is loaded', async () => {
    await openModal()
    ;(document.querySelector('.load-snapshot-tertiary') as HTMLElement).click()
    await settle()
    const blocks = [...document.querySelectorAll('.load-snapshot-disclosure')]
    const lastBlock = blocks[blocks.length - 1].getBoundingClientRect()
    expect(Math.round(rect('.setup-modal-foot').top - lastBlock.bottom)).toBe(20)
  })

  it('starts the text of every field at the same 16px inset', async () => {
    await openModal()
    ;(document.querySelector('.load-snapshot-tertiary') as HTMLElement).click()
    await settle()

    const path = document.querySelector('.config-path-input')!
    const pathInset =
      firstTextLeft(path.querySelector('.config-path-open')!) - path.getBoundingClientRect().left

    const name = document.querySelector<HTMLInputElement>('#ls-name')!
    const nameInset =
      name.getBoundingClientRect().left +
      parseFloat(getComputedStyle(name).paddingLeft) -
      name.closest('.config-input')!.getBoundingClientRect().left

    const triggers = [...document.querySelectorAll('.ui-select-trigger')]
    const releaseInset =
      firstTextLeft(triggers[0].querySelector('.ui-select-label')!) -
      triggers[0].getBoundingClientRect().left
    const hardwareIconInset =
      triggers[1].querySelector('.ui-select-icon')!.getBoundingClientRect().left -
      triggers[1].getBoundingClientRect().left

    expect([pathInset, nameInset, releaseInset, hardwareIconInset].map(Math.round)).toEqual([
      16, 16, 16, 16
    ])
  })
})
