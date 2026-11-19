import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page as browserPage, userEvent } from 'vitest/browser'
import { flushPromises, mount } from '@vue/test-utils'

import '../../assets/main.css'
import SettingsSectionList from './SettingsSectionList.vue'
import type { ActionDef, DetailFieldOption, DetailSection } from '../../types/ipc'
import { TID } from '../../../../shared/testIds'

interface Box {
  what: string
  top: number
  height: number
}

type PickerField = 'updateChannel' | 'pytorchStack'

const SCROLLBAR_GUTTER = 10

function titleBarPickerPane(windowWidth: number): number {
  const popup = Math.min(960, windowWidth - 2 * 24)
  const buildList = 280
  const bodyPadding = 2 * 16
  return popup - buildList - bodyPadding - SCROLLBAR_GUTTER
}

function buildPagePane(windowWidth: number): number {
  const frame = 2 * 8 + 244 + 8
  const pagePadding = 2 * 40
  return Math.min(1200, windowWidth - frame) - pagePadding - SCROLLBAR_GUTTER
}

const PANES = [
  { where: 'the title bar picker of the smallest window', width: titleBarPickerPane(800) },
  { where: 'the title bar picker at its widest', width: titleBarPickerPane(1280) },
  { where: 'the build page of the default window', width: buildPagePane(1280) },
  { where: 'the build page at its widest', width: buildPagePane(1600) }
]

const FIVE_MINUTES_AGO = Date.now() - 5 * 60 * 1000

const UPDATE_ACTIONS: ActionDef[] = [
  { id: 'update-comfyui', label: 'Update now', style: 'primary', enabled: true },
  { id: 'copy-update', label: 'Copy & update', enabled: true }
]

const PYTORCH_ACTIONS: ActionDef[] = [
  { id: 'change-pytorch', label: 'Change PyTorch', style: 'primary', enabled: true },
  { id: 'copy-pytorch', label: 'Copy & change PyTorch', enabled: true }
]

function updatesSection(latest: { commitsAheadKnown: boolean }): DetailSection {
  return {
    tab: 'update',
    title: 'Updates',
    fields: [
      {
        id: 'updateChannel',
        label: 'Update channel',
        value: 'stable',
        editable: true,
        refreshSection: true,
        editType: 'channel-cards',
        tooltip: 'Controls where updates come from.',
        options: [
          {
            value: 'stable',
            label: 'Stable',
            description: 'Tested releases, recommended for most users',
            recommended: true,
            data: {
              productName: 'ComfyUI',
              installedVersion: 'v0.3.75',
              latestVersion: 'v0.3.75',
              lastCheckedAt: FIVE_MINUTES_AGO,
              updateAvailable: false
            }
          },
          {
            value: 'latest',
            label: 'Latest on GitHub',
            description: 'Newest commits from the master branch',
            data: {
              productName: 'ComfyUI',
              installedVersion: 'v0.3.75',
              latestVersion: latest.commitsAheadKnown
                ? 'v0.3.75 + 12 commits (a1b2c3d)'
                : 'v0.3.75 (a1b2c3d)',
              lastCheckedAt: FIVE_MINUTES_AGO,
              updateAvailable: true,
              actions: UPDATE_ACTIONS,
              ...(latest.commitsAheadKnown ? {} : { enriching: true })
            }
          }
        ]
      }
    ],
    actions: [{ id: 'check-update', label: 'Check for updates', enabled: true }]
  }
}

function stack(
  torch: string,
  backend: { id: string; label: string },
  installed: boolean
): DetailFieldOption {
  return {
    value: `stack-${torch}`,
    label: `PyTorch ${torch}`,
    description: `torchvision 0.25.0  ·  torchaudio ${torch.split('+')[0]}  ·  2.5 GB download`,
    groupPath: [backend],
    data: {
      productName: 'PyTorch',
      installedVersion: '2.9.1+cu130',
      latestVersion: torch,
      latestLabel: 'Selected',
      updateAvailable: !installed,
      hideUpToDateBadge: true,
      ...(installed ? {} : { actions: PYTORCH_ACTIONS })
    }
  }
}

function pytorchSection(): DetailSection {
  const cu130 = { id: 'cu130', label: 'CUDA 13.0 (cu130)' }
  const cu128 = { id: 'cu128', label: 'CUDA 12.8 (cu128)' }
  const cpu = { id: 'cpu', label: 'CPU' }
  return {
    tab: 'update',
    title: 'PyTorch',
    fields: [
      {
        id: 'pytorchStack',
        label: 'PyTorch',
        value: 'stack-2.9.1+cu130',
        editable: true,
        refreshSection: true,
        editType: 'channel-cards',
        groupLabels: ['Backend'],
        tooltip: 'The PyTorch build this ComfyUI uses.',
        options: [
          stack('2.10.0+cu130', cu130, false),
          stack('2.9.1+cu130', cu130, true),
          stack('2.11.0+cu128', cu128, false),
          stack('2.11.0+cpu', cpu, false)
        ]
      }
    ]
  }
}

function updateTab(latest: { commitsAheadKnown: boolean }): DetailSection[] {
  return [updatesSection(latest), pytorchSection()]
}

let pane: HTMLElement | undefined

async function openUpdateTab(width: number, latest: { commitsAheadKnown: boolean }) {
  pane = document.createElement('div')
  pane.style.width = `${width}px`
  document.body.append(pane)
  const wrapper = mount(SettingsSectionList, {
    props: { sections: updateTab(latest) },
    attachTo: pane
  })
  await flushPromises()
  return wrapper
}

function onScreen(selector: string): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>(selector)].filter(
    (element) =>
      element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible'
  )
}

function only(selector: string): HTMLElement {
  const [element, ...others] = onScreen(selector)
  if (!element || others.length > 0) {
    throw new Error(`expected one element on screen for ${selector}, saw ${others.length + 1}`)
  }
  return element
}

function inPicker(field: PickerField, selector: string): string {
  return `[data-field-id="${field}"] .channel-picker ${selector}`
}

function boxOf(what: string, element: HTMLElement): Box {
  const paneTop = pane?.getBoundingClientRect().top ?? 0
  const rect = element.getBoundingClientRect()
  return {
    what,
    top: Math.round((rect.top - paneTop) * 100) / 100,
    height: Math.round(rect.height * 100) / 100
  }
}

function statusCard(field: PickerField): HTMLElement {
  return only(inPicker(field, '[data-testid="channel-picker-status"]'))
}

function dropdowns(field: PickerField): HTMLElement[] {
  return onScreen(inPicker(field, 'button[role="combobox"]'))
}

function fromTheCardDownToTheDropdowns(field: PickerField): Box[] {
  return [
    boxOf('status card', statusCard(field)),
    boxOf('label', only(inPicker(field, '.channel-picker-channel-header'))),
    ...dropdowns(field).map((dropdown) =>
      boxOf(dropdown.getAttribute('aria-label') ?? '', dropdown)
    )
  ]
}

function headline(field: PickerField): string {
  const product = only(inPicker(field, '.channel-picker-status .channel-picker-headline-product'))
  const version = only(inPicker(field, '.channel-picker-status .channel-picker-headline-version'))
  return `${product.textContent?.trim()} ${version.textContent?.trim()}`
}

function actionButtons(field: PickerField): string[] {
  return onScreen(inPicker(field, '.channel-picker-actions button')).map(
    (button) => button.textContent?.trim() ?? ''
  )
}

function bottomOf(element: HTMLElement): number {
  return element.getBoundingClientRect().bottom
}

async function pick(dropdownName: string, optionLabel: string): Promise<void> {
  await userEvent.click(only(`button[role="combobox"][aria-label="${dropdownName}"]`))
  await flushPromises()
  const option = onScreen('.ui-select-listbox [role="option"]').find(
    (candidate) =>
      candidate.querySelector('.ui-select-option-label')?.textContent?.trim() === optionLabel
  )
  if (!option) throw new Error(`${dropdownName} has no option named ${optionLabel}`)
  await userEvent.click(option)
  await expect.poll(() => document.querySelector('.ui-select-listbox')).toBeNull()
  await flushPromises()
}

beforeAll(async () => {
  const noListboxAnimation = document.createElement('style')
  noListboxAnimation.textContent = '.ui-select-listbox { animation: none !important; }'
  document.head.append(noListboxAnimation)
  await browserPage.viewport(1280, 900)
})

afterEach(() => {
  pane?.remove()
  pane = undefined
})

describe.each(PANES)('the Update tab in $where ($width px)', ({ width }) => {
  it('keeps the status card, the label and the dropdown in place when Latest on GitHub is picked, while its commits ahead are computed and once they are known', async () => {
    const tab = await openUpdateTab(width, { commitsAheadKnown: false })
    const settled = fromTheCardDownToTheDropdowns('updateChannel')
    expect(settled.map((box) => box.what)).toEqual(['status card', 'label', 'Update channel'])
    expect(headline('updateChannel')).toBe('ComfyUI v0.3.75')
    expect(actionButtons('updateChannel')).toEqual([])

    await pick('Update channel', 'Latest on GitHub')
    expect(headline('updateChannel')).toBe('ComfyUI v0.3.75 (a1b2c3d)')
    expect(only('.channel-picker-enriching').textContent).toContain('Computing commits ahead')
    expect(fromTheCardDownToTheDropdowns('updateChannel')).toEqual(settled)
    expect(statusCard('updateChannel').contains(only('.channel-picker-enriching'))).toBe(true)
    expect(actionButtons('updateChannel')).toEqual(['Copy & update', 'Update now'])
    expect(
      only(`[data-testid="${TID.updateActionButton('update-comfyui')}"]`).getBoundingClientRect()
        .top
    ).toBeGreaterThan(bottomOf(dropdowns('updateChannel')[0]!))

    await tab.setProps({ sections: updateTab({ commitsAheadKnown: true }) })
    await flushPromises()
    expect(headline('updateChannel')).toBe('ComfyUI v0.3.75 + 12 commits (a1b2c3d)')
    expect(onScreen('.channel-picker-enriching')).toEqual([])
    expect(fromTheCardDownToTheDropdowns('updateChannel')).toEqual(settled)

    await pick('Update channel', 'Stable — Current')
    expect(headline('updateChannel')).toBe('ComfyUI v0.3.75')
    expect(actionButtons('updateChannel')).toEqual([])
    expect(fromTheCardDownToTheDropdowns('updateChannel')).toEqual(settled)
  })

  it('keeps the PyTorch card, the label and both dropdowns in place as backends and versions are picked', async () => {
    await openUpdateTab(width, { commitsAheadKnown: true })
    const settled = fromTheCardDownToTheDropdowns('pytorchStack')
    expect(settled.map((box) => box.what)).toEqual(['status card', 'label', 'Backend', 'PyTorch'])
    expect(headline('pytorchStack')).toBe('PyTorch v2.9.1+cu130')
    expect(actionButtons('pytorchStack')).toEqual([])

    await pick('Backend', 'CUDA 12.8 (cu128)')
    expect(headline('pytorchStack')).toBe('PyTorch v2.11.0+cu128')
    expect(actionButtons('pytorchStack')).toEqual(['Copy & change PyTorch', 'Change PyTorch'])
    expect(fromTheCardDownToTheDropdowns('pytorchStack')).toEqual(settled)

    await pick('Backend', 'CPU')
    expect(headline('pytorchStack')).toBe('PyTorch v2.11.0+cpu')
    expect(fromTheCardDownToTheDropdowns('pytorchStack')).toEqual(settled)

    await pick('Backend', 'CUDA 13.0 (cu130)')
    expect(headline('pytorchStack')).toBe('PyTorch v2.10.0+cu130')
    expect(fromTheCardDownToTheDropdowns('pytorchStack')).toEqual(settled)

    await pick('PyTorch', 'PyTorch 2.9.1+cu130 — Current')
    expect(headline('pytorchStack')).toBe('PyTorch v2.9.1+cu130')
    expect(actionButtons('pytorchStack')).toEqual([])
    expect(fromTheCardDownToTheDropdowns('pytorchStack')).toEqual(settled)
  })
})
