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
async function mountView() {
  const { default: DownloadsFullView } = await import('./DownloadsFullView.vue')
  wrapper = mount(DownloadsFullView, { props: { state }, attachTo: document.body })
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
})
