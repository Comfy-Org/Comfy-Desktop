import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'

import '../../assets/main.css'
import BuildOverview from './BuildOverview.vue'
import type { BuildOverviewModel, OverviewChannel } from './overviewModel'
import type { ActionDef, Installation } from '../../types/ipc'

const updateNow: ActionDef = { id: 'update-comfyui', label: 'Update Now', style: 'primary' }
const copyUpdate: ActionDef = { id: 'copy-update', label: 'Copy & Update' }
const checkUpdate: ActionDef = { id: 'check-update', label: 'Check for updates' }
const changeTorch: ActionDef = { id: 'change-pytorch', label: 'Change PyTorch' }

const INSTALL = {
  id: 'inst-1',
  name: 'Flux Studio',
  sourceLabel: 'Standalone',
  sourceCategory: 'local',
  status: 'installed'
} as Installation

const LONG_PATH = `/Users/someone/${'a-very-long-folder-name-for-builds/'.repeat(8)}flux-studio`

interface Texts {
  channel: string
  version: string
  variant: string
  path: string
}

const SHORT: Texts = {
  channel: 'Stable',
  version: 'v0.3.60',
  variant: 'Apple Silicon (MPS)',
  path: '/builds/flux-studio'
}
const LONG: Texts = {
  channel: 'Latest on GitHub, newest commits from the master branch',
  version: 'v0.3.60-128-g4f8b2e1c9d0a7b6e5f4c3d2a',
  variant: 'NVIDIA GeForce RTX 4090 Laptop GPU (CUDA 12.8, driver 572.16)',
  path: LONG_PATH
}

const STATES: Record<string, Partial<OverviewChannel>> = {
  'up to date': {},
  'update available': {
    latestVersion: 'v0.45.3',
    updateAvailable: true,
    actions: [updateNow, copyUpdate]
  },
  'not checked yet': { latestVersion: undefined, lastCheckedAt: undefined },
  'computing commits ahead': { enriching: true }
}

const WIDTHS = { wide: 1100, narrow: 600 }

function model(
  texts: Texts,
  state: Partial<OverviewChannel>,
  withTorchMenu = true
): BuildOverviewModel {
  return {
    channelLabel: 'Update Channel',
    currentChannel: 'stable',
    channels: [
      {
        value: 'stable',
        label: texts.channel,
        description: 'Tested releases',
        installedVersion: texts.version,
        latestVersion: 'v0.3.60',
        lastCheckedAt: Date.now() - 5 * 60 * 1000,
        updateAvailable: false,
        enriching: false,
        actions: [],
        ...state
      }
    ],
    checkAction: checkUpdate,
    torch: withTorchMenu
      ? {
          label: 'PyTorch',
          current: '2.8.0+cu128',
          groups: [
            {
              id: 'cu128',
              label: 'CUDA 12.8',
              versions: [
                { value: 'a', version: '2.8.0+cu128', current: true, actions: [] },
                { value: 'b', version: '2.7.1+cu128', current: false, actions: [changeTorch] }
              ]
            }
          ]
        }
      : null,
    facts: {
      variant: { label: 'Variant', value: texts.variant },
      python: { label: 'Python', value: '3.12.9' },
      pytorch: { label: 'PyTorch', value: '2.8.0' },
      location: { label: 'Location', value: texts.path }
    }
  }
}

interface Shape {
  location: number
  pytorch: number
  disk: number
  python: number
}

async function measure(
  width: number,
  texts: Texts,
  state: Partial<OverviewChannel>,
  running = new Set<string>(),
  withTorchMenu = true
): Promise<{ shape: Shape; root: HTMLElement }> {
  const host = document.createElement('div')
  host.style.width = `${width}px`
  document.body.appendChild(host)
  const wrapper = mount(BuildOverview, {
    props: {
      installation: INSTALL,
      model: model(texts, state, withTorchMenu),
      diskUsage: '6.20 GB',
      diskFree: '412.00 GB',
      runningActionIds: running
    },
    attachTo: host
  })
  await flushPromises()
  const root = wrapper.element as HTMLElement
  const height = (id: string): number =>
    root.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.getBoundingClientRect().height
  return {
    root,
    shape: {
      location: height('build-overview-facts'),
      pytorch: height('build-overview-pytorch'),
      disk: height('build-overview-disk'),
      python: height('build-overview-python')
    }
  }
}

function overflowingCards(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('.build-overview-card')]
    .filter((card) => card.scrollWidth > card.clientWidth + 1)
    .map((card) => card.dataset.testid ?? '')
}

beforeEach(() => {
  setActivePinia(createTestingPinia({ stubActions: false }))
  ;(window as unknown as { api: Record<string, unknown> }).api = { openPath: vi.fn() }
})

describe.each(Object.entries(WIDTHS))('BuildOverview keeps its shape (%s window)', (_, width) => {
  it('gives Location and the fact cards the same height in every update state and with long names', async () => {
    const { shape: baseline } = await measure(width, SHORT, STATES['up to date'])
    const variants = [
      ...Object.entries(STATES).flatMap(([name, state]) => [
        { name: `${name}, short names`, run: () => measure(width, SHORT, state) },
        { name: `${name}, long names`, run: () => measure(width, LONG, state) }
      ]),
      {
        name: 'checking for updates',
        run: () => measure(width, SHORT, STATES['up to date'], new Set(['check-update']))
      }
    ]
    for (const variant of variants) {
      const { shape } = await variant.run()
      expect(shape, variant.name).toEqual(baseline)
    }
  })

  it('keeps the three fact cards the same height as each other', async () => {
    const { shape } = await measure(width, LONG, STATES['update available'])
    expect(shape.pytorch).toBe(shape.disk)
    expect(shape.disk).toBe(shape.python)
  })

  it('lines up the last line of the three fact cards, with or without a PyTorch menu', async () => {
    for (const withMenu of [true, false]) {
      const { root } = await measure(width, SHORT, STATES['up to date'], new Set(), withMenu)
      const bottom = (selector: string): number =>
        root.querySelector<HTMLElement>(selector)!.getBoundingClientRect().bottom
      const variant = bottom('[data-testid="build-overview-variant"]')
      expect(
        Math.abs(variant - bottom('[data-testid="build-overview-disk"] > span:last-child')),
        `menu: ${withMenu}`
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(variant - bottom('[data-testid="build-overview-python"] > span:last-child')),
        `menu: ${withMenu}`
      ).toBeLessThanOrEqual(1)
    }
  })

  it('keeps long names on one line inside their card', async () => {
    const { root } = await measure(width, LONG, STATES['update available'])
    expect(overflowingCards(root)).toEqual([])
    const oneLine = (selector: string): void => {
      const el = root.querySelector<HTMLElement>(selector)!
      expect(el.scrollHeight, selector).toBeLessThanOrEqual(
        parseFloat(getComputedStyle(el).lineHeight) + 1
      )
    }
    oneLine('[data-testid="build-overview-variant"]')
    oneLine('[data-testid="build-overview-comfyui-version"]')
    oneLine('[data-testid="build-overview-location"] .font-mono')
  })
})
