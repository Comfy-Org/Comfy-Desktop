import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type {
  PopupDownloadAction,
  PopupDownloadsState
} from '../../../preload/comfyTitlePopupPreload'

let wrapper: VueWrapper | undefined
const originalBridge = Object.getOwnPropertyDescriptor(window, '__comfyTitlePopup')
const actions: PopupDownloadAction[] = []
const state: PopupDownloadsState = {
  active: [
    {
      id: 'active',
      url: 'https://example.com/active',
      filename: 'active.bin',
      progress: 0.5,
      status: 'downloading'
    }
  ],
  recent: [
    {
      id: 'done',
      url: 'https://example.com/done',
      filename: 'done.bin',
      savePath: '/models/done.bin',
      progress: 1,
      status: 'completed'
    },
    {
      id: 'failed',
      url: 'https://example.com/failed',
      filename: 'failed.bin',
      progress: 0.2,
      status: 'error'
    }
  ]
}

beforeEach(() => {
  actions.length = 0
  vi.resetModules()
  Object.defineProperty(window, '__comfyTitlePopup', {
    configurable: true,
    value: {
      platform: 'darwin',
      downloadsAction: (action: PopupDownloadAction) => actions.push(action),
      getDownloadThumbnail: async () => null,
      close: vi.fn()
    }
  })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  if (originalBridge) Object.defineProperty(window, '__comfyTitlePopup', originalBridge)
  else delete (window as unknown as { __comfyTitlePopup?: unknown }).__comfyTitlePopup
})
async function mountView(viewState: PopupDownloadsState = state) {
  const { default: DownloadsFullView } = await import('./DownloadsFullView.vue')
  wrapper = mount(DownloadsFullView, { props: { state: viewState }, attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('DownloadsFullView shared controls', () => {
  it('filters downloads through the shared keyboard-accessible filter group', async () => {
    const view = await mountView()
    const tabs = view.findAll('.dlm-filter-chip')
    expect(tabs).toHaveLength(4)
    expect(view.findAll('.dlm-row')).toHaveLength(3)
    ;(tabs[0]!.element as HTMLElement).focus()
    await tabs[0]!.trigger('keydown', { key: 'ArrowRight' })
    await flushPromises()
    await tabs[1]!.trigger('click')
    await flushPromises()
    expect(tabs[1]!.attributes('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(tabs[1]!.element)
    expect(view.findAll('.dlm-row')).toHaveLength(1)
    expect(view.get('.dlm-row').text()).toContain('active.bin')
    await tabs[1]!.trigger('keydown', { key: 'End' })
    await flushPromises()
    await tabs[3]!.trigger('click')
    await flushPromises()
    expect(tabs[3]!.attributes('aria-pressed')).toBe('true')
    expect(view.get('.dlm-row').text()).toContain('failed.bin')
  })

  it('keeps per-download actions addressed by their stable job id', async () => {
    const view = await mountView()
    const rows = view.findAll('.dlm-row')
    const active = rows.find((row) => row.text().includes('active.bin'))!
    const failed = rows.find((row) => row.text().includes('failed.bin'))!
    const completed = rows.find((row) => row.text().includes('done.bin'))!
    await active.get('.dlm-btn').trigger('click')
    await failed.get('.dlm-btn').trigger('click')
    await completed.get('.dlm-btn').trigger('click')
    expect(actions).toEqual([
      { action: 'pause', ref: 'active', url: 'https://example.com/active' },
      { action: 'retry', ref: 'failed', url: 'https://example.com/failed' },
      {
        action: 'show-in-folder',
        ref: 'done',
        url: 'https://example.com/done',
        savePath: '/models/done.bin'
      }
    ])
    await view.get('.dlm-clear-btn').trigger('click')
    expect(actions.at(-1)).toEqual({ action: 'clear-finished' })
  })

  it('ends every row with an always-visible × that cancels an active download and removes a finished one', async () => {
    const view = await mountView()
    const rows = view.findAll('.dlm-row')
    for (const row of rows)
      expect(row.get('.dlm-trailing .dlm-x').classes()).toContain('opacity-50')
    const active = rows.find((row) => row.text().includes('active.bin'))!
    const failed = rows.find((row) => row.text().includes('failed.bin'))!
    expect(active.get('.dlm-x').attributes('aria-label')).toBe('Cancel')
    await active.get('.dlm-x').trigger('click')
    await failed.get('.dlm-x').trigger('click')
    expect(actions).toEqual([
      { action: 'cancel', ref: 'active', url: 'https://example.com/active' },
      { action: 'dismiss', ref: 'failed', url: 'https://example.com/failed' }
    ])
  })
})

describe('DownloadsFullView close', () => {
  it('puts the round close button outside the card and closes the window', async () => {
    const view = await mountView()
    const close = view.get('[aria-label="Close"]')
    expect(view.get('.dlm-card').find('[aria-label="Close"]').exists()).toBe(false)
    expect(close.classes()).toContain('rounded-full')
    await close.trigger('click')
    const bridge = (window as unknown as { __comfyTitlePopup: { close: () => void } })
      .__comfyTitlePopup
    expect(bridge.close).toHaveBeenCalledOnce()
  })
})

describe('DownloadsFullView progress ring', () => {
  const live = (entry: Partial<PopupDownloadsState['active'][number]>): PopupDownloadsState => ({
    active: [
      {
        id: 'live',
        url: 'https://example.com/live',
        filename: 'live.bin',
        progress: 0,
        status: 'downloading',
        ...entry
      }
    ],
    recent: []
  })
  const arcOffset = (view: VueWrapper) =>
    Number(view.get('.dlm-ring-arc').attributes('stroke-dashoffset'))

  it('draws the arc to the downloaded share and moves it when progress changes', async () => {
    const view = await mountView(live({ progress: 0.5, totalBytes: 100, receivedBytes: 50 }))
    const ring = view.get('.dlm-ring')
    expect(ring.attributes('role')).toBe('progressbar')
    expect(ring.attributes('aria-valuenow')).toBe('50')
    expect(arcOffset(view)).toBe(50)
    expect(view.get('.dlm-ring-svg').classes()).not.toContain('animate-spin')
    expect(view.find('.lucide-download').exists()).toBe(true)
    await view.setProps({
      state: live({ progress: 0.73, totalBytes: 100, receivedBytes: 73 })
    })
    expect(ring.attributes('aria-valuenow')).toBe('73')
    expect(arcOffset(view)).toBe(27)
  })

  it('spins a partial arc with no value while the size is unknown', async () => {
    for (const entry of [
      { status: 'pending' as const },
      { status: 'downloading' as const, totalBytes: undefined }
    ]) {
      const view = await mountView(live(entry))
      const ring = view.get('.dlm-ring')
      expect(ring.attributes('aria-valuenow')).toBeUndefined()
      expect(ring.attributes('aria-valuemin')).toBe('0')
      expect(ring.attributes('aria-valuemax')).toBe('100')
      expect(view.get('.dlm-ring-svg').classes()).toEqual(
        expect.arrayContaining(['animate-spin', 'motion-reduce:animate-none'])
      )
      expect(arcOffset(view)).toBe(75)
      view.unmount()
    }
    wrapper = undefined
  })

  it('holds the value when paused and swaps the arrow for a pause mark', async () => {
    const view = await mountView(live({ status: 'paused', progress: 0.3, totalBytes: 100 }))
    const ring = view.get('.dlm-ring')
    expect(ring.attributes('aria-valuenow')).toBe('30')
    expect(arcOffset(view)).toBe(70)
    expect(view.get('.dlm-ring-svg').classes()).not.toContain('animate-spin')
    expect(view.find('.lucide-pause').exists()).toBe(true)
    expect(view.find('.lucide-download').exists()).toBe(false)
  })

  it('keeps the arc transition off for reduced motion', async () => {
    const view = await mountView(live({ progress: 0.5, totalBytes: 100 }))
    expect(view.get('.dlm-ring-arc').classes()).toEqual(
      expect.arrayContaining(['transition-[stroke-dashoffset]', 'motion-reduce:transition-none'])
    )
  })
})
