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
      receivedBytes: 6_120_000_000,
      totalBytes: 14_570_000_000,
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
  it('lines the title, the tabs and the list card up on one left edge, with every row icon 18px inside the card', async () => {
    await mountView()
    const title = box('.dlm-title').left
    expect(box('.dlm-filterbar').left).toBe(title)
    expect(box('.dlm-list').left).toBe(title)
    for (const icon of document.querySelectorAll('.dlm-icon-circle')) {
      expect(icon.getBoundingClientRect().left).toBe(title + 18)
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

  it('gives every row the same action grid: primary buttons and trailing slots share one right edge, down to Clear finished', async () => {
    await mountView()
    const rows = [...document.querySelectorAll<HTMLElement>('.dlm-row')]
    expect(rows.map((row) => row.className.match(/is-\w+/)![0])).toEqual([
      'is-active',
      'is-completed',
      'is-error'
    ])
    const right = (el: Element) => el.getBoundingClientRect().right
    const primaries = rows.map((row) => right(row.querySelector('.dlm-primary .dlm-btn')!))
    const trailing = rows.map((row) => row.querySelector('.dlm-trailing')!.getBoundingClientRect())
    expect(new Set(primaries).size).toBe(1)
    expect(new Set(trailing.map((slot) => slot.right)).size).toBe(1)
    expect(new Set(trailing.map((slot) => slot.width)).size).toBe(1)
    for (const row of rows) expect(row.querySelector('.dlm-trailing .dlm-x')).not.toBeNull()
    expect(primaries[0]).toBeLessThan(trailing[0]!.left)
    const clear = right(document.querySelector('.dlm-clear-btn')!)
    expect(box('.dlm-list').right).toBe(clear)
    expect(trailing[0]!.right).toBe(clear - 18)
  })

  it('puts every row in one card with a line between rows only, edge to edge', async () => {
    await mountView()
    const list = document.querySelector<HTMLElement>('.dlm-list')!
    const card = getComputedStyle(list)
    expect(card.borderTopLeftRadius).toBe('14px')
    expect(card.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(document.querySelectorAll('.dlm-list')).toHaveLength(1)
    const rows = [...list.querySelectorAll<HTMLElement>(':scope > .dlm-row')]
    expect(rows).toHaveLength(3)
    const lines = rows.map((row) => getComputedStyle(row).borderTopWidth)
    expect(lines).toEqual(['0px', '1px', '1px'])
    for (const row of rows) {
      const style = getComputedStyle(row)
      expect(style.borderBottomWidth).toBe('0px')
      expect(style.borderTopLeftRadius).toBe('0px')
      expect(style.paddingLeft).toBe('18px')
      expect(style.paddingRight).toBe('18px')
      const r = row.getBoundingClientRect()
      expect(r.left).toBe(box('.dlm-list').left)
      expect(r.right).toBe(box('.dlm-list').right)
    }
    expect(getComputedStyle(rows[1]!).borderTopColor).not.toBe('rgba(0, 0, 0, 0)')
  })

  it('keeps rows 72px tall with their actions centred, and shows progress on the ring instead of a bar', async () => {
    await mountView()
    const rows = [...document.querySelectorAll<HTMLElement>('.dlm-row')].map((row) =>
      row.getBoundingClientRect()
    )
    expect(rows.map((row) => row.height)).toEqual([72, 72, 72])
    for (const row of document.querySelectorAll('.dlm-row')) {
      const r = row.getBoundingClientRect()
      for (const slot of row.querySelectorAll('.dlm-primary .dlm-btn, .dlm-trailing .dlm-x')) {
        const b = slot.getBoundingClientRect()
        expect(Math.abs(b.top + b.height / 2 - (r.top + r.height / 2))).toBeLessThanOrEqual(0.5)
      }
    }
    expect(document.querySelector('.dlm-bar')).toBeNull()
    expect(document.querySelectorAll('.dlm-ring')).toHaveLength(1)
    const ring = document.querySelector('.dlm-row.is-active .dlm-ring')!
    expect(ring.getBoundingClientRect().width).toBe(32)
    expect(ring.getAttribute('role')).toBe('progressbar')
    expect(ring.getAttribute('aria-valuenow')).toBe('42')
    expect(ring.getAttribute('aria-valuemin')).toBe('0')
    expect(ring.getAttribute('aria-valuemax')).toBe('100')
    expect(ring.getAttribute('aria-label')).toBe('Download progress for wan2.2-t2v.safetensors')
    const arc = ring.querySelector<SVGCircleElement>('.dlm-ring-arc')!
    expect(arc.getAttribute('pathLength')).toBe('100')
    expect(Number(arc.getAttribute('stroke-dashoffset'))).toBe(100 - 42)
    expect(getComputedStyle(arc).transitionProperty).toBe('stroke-dashoffset')
    expect(getComputedStyle(arc).strokeWidth).toBe('2px')
    expect(ring.querySelector('.dlm-ring-icon')!.getBoundingClientRect().width).toBe(14)
  })

  it('keeps the ring track visible against the card', async () => {
    await mountView()
    const track = getComputedStyle(document.querySelector('.dlm-ring-track')!).stroke
    const alpha = Number(track.match(/\/\s*([\d.]+)\)$/)?.[1] ?? '1')
    expect(alpha).toBeGreaterThanOrEqual(0.2)
    expect(alpha).toBeLessThanOrEqual(0.25)
  })

  it('says progress and failure once', async () => {
    await mountView()
    const active = document.querySelector('.dlm-row.is-active')!
    expect(active.querySelector('.dlm-sub')!.textContent).toMatch(/^42% · /)
    expect(active.querySelector('.dlm-primary')!.textContent!.trim()).toBe('')
    const failed = document.querySelector('.dlm-row.is-error')!
    expect(failed.textContent).not.toMatch(/Failed/)
    expect(failed.querySelector('.dlm-sub')!.textContent).toBe('Network error')
    expect(
      [...document.querySelectorAll('.dlm-footer-stat')].map((stat) => stat.textContent!.trim())
    ).toEqual(['1 active', '1 completed', '1 failed'])
  })
})
