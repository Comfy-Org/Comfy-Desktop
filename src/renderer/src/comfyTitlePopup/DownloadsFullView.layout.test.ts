import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import '../assets/main.css'
import DownloadsFullView from './DownloadsFullView.vue'
import type { PopupDownloadsState } from '../../../preload/comfyTitlePopupPreload'

const state: PopupDownloadsState = {
  active: [
    {
      id: 'active',
      url: 'https://example.com/active',
      filename: 'wan2.2-t2v.safetensors',
      progress: 0.42,
      status: 'downloading'
    }
  ],
  recent: [
    {
      id: 'done',
      url: 'https://example.com/done',
      filename: 'flux1-dev.safetensors',
      savePath: '/models/flux1-dev.safetensors',
      progress: 1,
      status: 'completed'
    },
    {
      id: 'failed',
      url: 'https://example.com/failed',
      filename: 'sdxl-vae.safetensors',
      progress: 0,
      status: 'error',
      error: 'Network error'
    }
  ]
}

const mounted: VueWrapper[] = []
const hosts: HTMLElement[] = []

beforeAll(() => page.viewport(1000, 700))

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
  while (hosts.length) hosts.pop()?.remove()
})

async function mountView() {
  Object.defineProperty(window, '__comfyTitlePopup', {
    configurable: true,
    value: {
      platform: 'darwin',
      downloadsAction: () => {},
      getDownloadThumbnail: async () => null,
      close: () => {}
    }
  })
  const host = document.createElement('div')
  host.style.cssText = 'position: fixed; left: 40px; top: 40px; width: 860px; height: 560px'
  document.body.append(host)
  hosts.push(host)
  const wrapper = mount(DownloadsFullView, { props: { state }, attachTo: host })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()

describe('DownloadsFullView layout', () => {
  it('lines the title, the tabs and every row icon up on one left edge, with no line under the title or the tabs', async () => {
    await mountView()
    const title = box('.dlm-title').left
    expect(box('.dlm-filterbar').left).toBe(title)
    for (const icon of document.querySelectorAll('.dlm-icon-circle')) {
      expect(icon.getBoundingClientRect().left).toBe(title)
    }
    const card = document.querySelector<HTMLElement>('.dlm-card')!
    expect(title - box('.dlm-card').left - card.clientLeft).toBe(24)
    for (const selector of ['.dlm-modal-header', '.dlm-filterbar']) {
      expect(getComputedStyle(document.querySelector(selector)!).borderBottomWidth).toBe('0px')
    }
  })

  it('sizes the tabs to their names instead of stretching them across the card', async () => {
    await mountView()
    const tabs = [...document.querySelectorAll('.dlm-filter-chip')].map(
      (tab) => tab.getBoundingClientRect().width
    )
    expect(tabs.length).toBe(4)
    expect(box('.dlm-filterbar').width).toBeLessThan(box('.dlm-card').width / 2)
    expect(new Set(tabs).size).toBeGreaterThan(1)
  })
})
