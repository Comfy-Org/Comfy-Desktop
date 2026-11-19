import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

import '../assets/main.css'
import DownloadsView from './DownloadsView.vue'
import type { PopupDownloadsState } from '../../../preload/comfyTitlePopupPreload'

const state: PopupDownloadsState = {
  active: [],
  recent: [
    {
      id: 'done',
      url: 'https://example.com/done',
      filename: 'flux1-dev.safetensors',
      directory: 'models/checkpoints',
      savePath: '/models/flux1-dev.safetensors',
      progress: 1,
      status: 'completed',
      createdAt: 3
    },
    {
      id: 'cancelled',
      url: 'https://example.com/cancelled',
      filename: 'sdxl-vae.safetensors',
      directory: 'models/vae',
      progress: 0.4,
      status: 'cancelled',
      createdAt: 2
    },
    {
      id: 'failed',
      url: 'https://example.com/failed',
      filename: 'clip_l.safetensors',
      directory: 'models/clip',
      progress: 0.2,
      status: 'error',
      error: 'Network error',
      createdAt: 1
    }
  ]
}

const mounted: VueWrapper[] = []
const hosts: HTMLElement[] = []

beforeAll(() => page.viewport(800, 600))

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
  while (hosts.length) hosts.pop()?.remove()
})

async function mountPopup() {
  Object.defineProperty(window, '__comfyTitlePopup', {
    configurable: true,
    value: {
      platform: 'darwin',
      downloadsAction: () => {},
      openSettingsTab: () => {},
      openDownloadsModal: () => {},
      getDownloadThumbnail: async () => null
    }
  })
  const host = document.createElement('div')
  host.style.cssText = 'width: 405px; height: 396px'
  document.body.append(host)
  hosts.push(host)
  const wrapper = mount(DownloadsView, { props: { state }, attachTo: host })
  mounted.push(wrapper)
  await flushPromises()
  await parkPointerOutsidePopup()
  return wrapper
}

async function parkPointerOutsidePopup() {
  const spot = document.createElement('div')
  spot.style.cssText = 'position: fixed; right: 0; bottom: 0; width: 8px; height: 8px'
  document.body.append(spot)
  hosts.push(spot)
  await userEvent.hover(spot)
}

const rect = (el: Element) => el.getBoundingClientRect()

describe('Downloads popup layout', () => {
  it('draws every row on one card, the same fill, split by dividers that run edge to edge', async () => {
    const wrapper = await mountPopup()
    const list = wrapper.get('.downloads-list').element
    const rows = wrapper.findAll('.downloads-item').map((r) => r.element as HTMLElement)

    expect(getComputedStyle(list).borderTopLeftRadius).toBe('14px')
    expect(new Set(rows.map((r) => getComputedStyle(r).backgroundColor)).size).toBe(1)
    expect(rows.map((r) => getComputedStyle(r).borderTopWidth)).toEqual(['0px', '1px', '1px'])
    for (const row of rows) {
      expect(rect(row).left).toBe(rect(list).left)
      expect(rect(row).right).toBe(rect(list).right)
    }
  })

  it('sets View all on the title row, on the same baseline, aligned with the card edge', async () => {
    const wrapper = await mountPopup()
    const title = wrapper.get('.downloads-title').element
    const link = wrapper.get('.downloads-link').element
    const list = wrapper.get('.downloads-list').element
    const baseline = (el: Element) => {
      const text = [...el.childNodes].find(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()
      )
      const range = document.createRange()
      range.selectNodeContents(text!)
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.font = getComputedStyle(el).font
      return rect(range).top + ctx.measureText(text!.textContent!).fontBoundingBoxAscent
    }

    expect(Math.abs(baseline(title) - baseline(link))).toBeLessThanOrEqual(0.5)
    expect(rect(title).left).toBe(rect(list).left)
    expect(rect(link).right).toBe(rect(list).right)
  })

  it('gives the header the same top inset as the side inset and 12px above the card', async () => {
    const wrapper = await mountPopup()
    const root = rect(wrapper.get('.downloads').element)
    const title = rect(wrapper.get('.downloads-title').element)
    const link = rect(wrapper.get('.downloads-link').element)
    const list = rect(wrapper.get('.downloads-list').element)

    expect(Math.min(title.top, link.top) - root.top).toBe(list.left - root.left)
    expect(list.top - Math.max(title.bottom, link.bottom)).toBe(12)
  })

  it('shows the row action only on hover or focus, beside the remove button without covering it', async () => {
    const wrapper = await mountPopup()
    const row = wrapper.get('.is-cancelled')
    const action = row.get('.downloads-item-action').element as HTMLElement
    const close = row.get('.downloads-item-close').element
    const name = row.get('.downloads-item-name').element as HTMLElement
    const nameLeft = rect(name).left
    const rowHeight = rect(row.element).height

    expect(getComputedStyle(action).display).toBe('none')

    ;(row.element as HTMLElement).focus()
    await vi.waitFor(() => expect(getComputedStyle(action).display).toBe('flex'))
    expect(rect(action).right).toBeLessThanOrEqual(rect(close).left)
    expect(rect(action).top).toBeGreaterThanOrEqual(rect(row.element).top)
    expect(rect(action).bottom).toBeLessThanOrEqual(rect(row.element).bottom)
    expect(rect(row.element).height).toBe(rowHeight)
    expect(rect(name).left).toBe(nameLeft)
  })

  it('truncates the name with an ellipsis just before the action, never under it', async () => {
    const wrapper = await mountPopup()
    const row = wrapper.get('.is-cancelled')
    const name = row.get('.downloads-item-name').element as HTMLElement
    const action = row.get('.downloads-item-action').element as HTMLElement

    ;(row.element as HTMLElement).focus()
    await vi.waitFor(() => expect(getComputedStyle(action).display).toBe('flex'))
    expect(getComputedStyle(name).textOverflow).toBe('ellipsis')
    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
    expect(rect(name).right).toBeLessThanOrEqual(rect(action).left)
  })

  it('shows Show in Finder as a filled square icon button beside the remove button', async () => {
    const wrapper = await mountPopup()
    const row = wrapper.get('.is-completed')
    const reveal = row.get('.downloads-item-reveal').element as HTMLElement
    const close = row.get('.downloads-item-close').element
    const name = row.get('.downloads-item-name').element as HTMLElement
    const nameLeft = rect(name).left
    const rowHeight = rect(row.element).height

    ;(row.element as HTMLElement).focus()
    await vi.waitFor(() => expect(rect(reveal).width).toBeGreaterThan(0))
    const style = getComputedStyle(reveal)
    expect(rect(reveal).width).toBe(rect(reveal).height)
    expect(rect(reveal).height).toBe(rect(close).height)
    expect(rect(reveal).top).toBe(rect(close).top)
    expect(Number.parseFloat(style.borderTopLeftRadius)).toBeGreaterThan(0)
    expect(style.backgroundColor).not.toBe(getComputedStyle(row.element).backgroundColor)
    expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(reveal.textContent?.trim()).toBe('')
    expect(rect(reveal).right).toBeLessThanOrEqual(rect(close).left)
    expect(rect(name).right).toBeLessThanOrEqual(rect(reveal).left)
    expect(rect(row.element).height).toBe(rowHeight)
    expect(rect(name).left).toBe(nameLeft)
  })

  it('puts the remove glyph 18px from the card edge', async () => {
    const wrapper = await mountPopup()
    const list = wrapper.get('.downloads-list').element
    for (const glyph of wrapper.findAll('.downloads-item-close svg')) {
      expect(rect(list).right - rect(glyph.element).right).toBe(18)
    }
  })
})
