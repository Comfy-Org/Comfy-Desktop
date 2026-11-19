import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import '../assets/main.css'
import { stubWindowApi } from '../lib/stubWindowApi'
import { useProgressStore } from '../stores/progressStore'
import type { ActionResult } from '../types/ipc'

vi.mock('../lib/telemetry', () => ({
  emitTelemetryAction: vi.fn(),
  toErrorBucket: vi.fn()
}))
vi.mock('../components/ui/DesktopDialogSurface.vue', () => ({
  default: {
    props: ['ariaLabel', 'contentClass', 'overlayClass'],
    emits: ['close'],
    template:
      '<div data-testid="overlay" :class="overlayClass" /><div role="dialog" :aria-label="ariaLabel" :class="contentClass" style="position: fixed"><slot /></div>'
  }
}))

import BuildProgressDialog from './BuildProgressDialog.vue'

const ID = 'inst-a'
let wrapper: VueWrapper | null = null

beforeEach(() => {
  document.documentElement.classList.add('dark')
  document.documentElement.dataset.theme = 'dark'
  setActivePinia(createPinia())
  stubWindowApi({
    onInstallProgress: vi.fn(() => () => {}),
    onComfyOutput: vi.fn(() => () => {}),
    onErrorDetail: vi.fn(() => () => {}),
    onInstallationsChanged: vi.fn(() => () => {}),
    onInstallationsVersionsUpdated: vi.fn(() => () => {})
  })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

async function openFailedStart(): Promise<HTMLElement> {
  wrapper = mount(BuildProgressDialog, { props: { installationId: ID }, attachTo: document.body })
  let settle: (result: ActionResult) => void = () => {}
  useProgressStore().startOperation({
    installationId: ID,
    title: 'Starting ComfyUI',
    opKind: 'launch',
    apiCall: () =>
      new Promise<ActionResult>((resolve) => {
        settle = resolve
      })
  })
  await flushPromises()
  settle({ ok: false, message: 'Port 8188 is in use' })
  await flushPromises()
  return document.body
}

const box = (el: Element) => el.getBoundingClientRect()
const testId = (root: Element, id: string) => root.querySelector(`[data-testid="${id}"]`)!
const luminance = (...layers: string[]) => {
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 1, 1)
  for (const color of layers) {
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 1, 1)
  }
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

describe('the start logs window follows the modal layout', () => {
  it('pads the content 20px and squares the footer buttons 16px from the line and the bottom', async () => {
    const root = await openFailedStart()
    const body = testId(root, 'build-progress-body')
    const footer = testId(root, 'build-progress-footer')
    const card = body.parentElement!
    const retry = testId(root, 'build-progress-retry')
    const close = testId(root, 'build-progress-close-failed')

    const bodyStyle = getComputedStyle(body)
    expect([
      bodyStyle.paddingTop,
      bodyStyle.paddingRight,
      bodyStyle.paddingBottom,
      bodyStyle.paddingLeft
    ]).toEqual(['20px', '20px', '20px', '20px'])
    expect(getComputedStyle(footer).borderTopWidth).toBe('1px')
    expect(box(retry).top - box(footer).top - 1).toBeCloseTo(16, 0)
    expect(box(card).bottom - box(retry).bottom - 1).toBeCloseTo(16, 0)
    expect(box(card).right - box(retry).right - 1).toBeCloseTo(20, 0)
    expect(box(close).bottom).toBeCloseTo(box(retry).bottom, 0)
  })

  it('has no line under the title and keeps the × outside the card', async () => {
    const root = await openFailedStart()
    const card = testId(root, 'build-progress-body').parentElement!

    expect(getComputedStyle(root.querySelector('h2')!).borderBottomWidth).toBe('0px')
    expect(box(testId(root, 'build-progress-close')).left).toBeGreaterThanOrEqual(box(card).right)
  })

  it('dims the page behind with plain black at 70%, with no blur', async () => {
    const root = await openFailedStart()
    const overlay = document.querySelector('[data-testid="overlay"]')!
    const card = testId(root, 'build-progress-body').parentElement!

    expect(getComputedStyle(overlay).backdropFilter).toBe('none')
    expect(getComputedStyle(overlay).filter).toBe('none')
    expect(getComputedStyle(card).backdropFilter).toBe('none')
    expect(luminance('#fff', getComputedStyle(overlay).backgroundColor)).toBeCloseTo(
      luminance('rgb(77 77 77)'),
      -1
    )
  })

  it('draws the logs box a step lighter than the card', async () => {
    const root = await openFailedStart()
    const card = testId(root, 'build-progress-body').parentElement!

    const cardFill = getComputedStyle(card).backgroundColor
    const logsFill = getComputedStyle(testId(root, 'build-progress-logs')).backgroundColor
    expect(luminance(cardFill, logsFill)).toBeGreaterThan(luminance(cardFill) + 4)
  })
})
