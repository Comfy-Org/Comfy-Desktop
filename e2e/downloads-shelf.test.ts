import { test, expect, type ElectronApplication } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'
import { openDownloadsTray } from './support/chooserHelpers'
import {
  closeTitlePopupIfOpen,
  isPopupVisible,
  titlePopupPage,
  TITLE_REOPEN_SUPPRESSION_MS,
  type WebContentsPage
} from './support/cdpPages'
import { getTitlePopupBounds, seedDownloads, type DownloadProgressLike } from './support/devHooks'

let ctx: AppContext
let popup: WebContentsPage
let entryCounter = 0

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp({ settings: { firstUseCompleted: true, telemetryEnabled: false } })
  popup = titlePopupPage(ctx.app)
})

test.afterAll(async () => {
  await ctx.cleanup()
})

test.beforeEach(async () => {
  await closeTitlePopupIfOpen(ctx.app)
  await new Promise((r) => setTimeout(r, TITLE_REOPEN_SUPPRESSION_MS))
  await seedDownloads(ctx.app, { active: [], recent: [] })
  entryCounter = 0
})

test('empty drawer fits content (popup height < 260px) @windows @macos @linux', async () => {
  await openDownloadsTray(ctx.titleBar)
  await waitForPopupVisible(ctx.app)
  await expect(async () => {
    const bounds = await getTitlePopupBounds(ctx.app)
    expect(bounds?.kind).toBe('downloads')
    expect(bounds!.bounds.height).toBeLessThan(260)
    expect(bounds!.bounds.height).toBeGreaterThan(40)
  }).toPass({ timeout: 5_000 })
})

test('one downloading entry fits content (NOT clipped at 396 ceiling) @windows @macos @linux', async () => {
  await seedDownloads(ctx.app, {
    active: [
      makeEntry({
        url: 'https://example.test/m1.safetensors',
        filename: 'm1.safetensors',
        status: 'downloading',
        progress: 0.5
      })
    ],
    recent: []
  })
  await openDownloadsTray(ctx.titleBar)
  await waitForPopupVisible(ctx.app)
  await expect(async () => {
    const bounds = await getTitlePopupBounds(ctx.app)
    expect(bounds?.kind).toBe('downloads')
    expect(bounds!.bounds.height).toBeGreaterThan(80)
    expect(bounds!.bounds.height).toBeLessThan(260)
  }).toPass({ timeout: 5_000 })
})

test('many entries cap at the ceiling and the list scrolls @windows @macos @linux', async () => {
  const active: DownloadProgressLike[] = []
  for (let i = 0; i < 12; i++) {
    active.push(
      makeEntry({
        url: `https://example.test/big-${i}.safetensors`,
        filename: `big-${i}.safetensors`,
        status: 'downloading',
        progress: 0.1 * i,
        createdAt: i
      })
    )
  }
  await seedDownloads(ctx.app, { active, recent: [] })
  await openDownloadsTray(ctx.titleBar)
  await waitForPopupVisible(ctx.app)
  await expect(async () => {
    const bounds = await getTitlePopupBounds(ctx.app)
    expect(bounds?.kind).toBe('downloads')
    expect(bounds!.bounds.height).toBeLessThanOrEqual(396)
    expect(bounds!.bounds.height).toBeGreaterThan(356)

    const overflow = await popup.evaluate<{ scroll: number; client: number }>(`(() => {
      const el = document.querySelector('.downloads-list')
      return el ? { scroll: el.scrollHeight, client: el.clientHeight } : { scroll: 0, client: 0 }
    })()`)
    expect(overflow.scroll).toBeGreaterThan(overflow.client)
  }).toPass({ timeout: 5_000 })
})

test('per-status row close button maps to the right action @windows @macos @linux', async () => {
  await seedDownloads(ctx.app, {
    active: [
      makeEntry({ url: 'u-dl', filename: 'dl.safetensors', status: 'downloading', progress: 0.5 }),
      makeEntry({ url: 'u-pa', filename: 'pa.safetensors', status: 'paused', progress: 0.5 }),
      makeEntry({ url: 'u-pe', filename: 'pe.safetensors', status: 'pending', progress: 0 })
    ],
    recent: [
      makeEntry({
        url: 'u-co',
        filename: 'co.safetensors',
        status: 'completed',
        progress: 1,
        savePath: '/tmp/co.safetensors'
      }),
      makeEntry({
        url: 'u-er',
        filename: 'er.safetensors',
        status: 'error',
        progress: 0,
        error: 'boom'
      }),
      makeEntry({ url: 'u-ca', filename: 'ca.safetensors', status: 'cancelled', progress: 0 })
    ]
  })
  await openDownloadsTray(ctx.titleBar)
  await waitForPopupVisible(ctx.app)
  await waitForStableBounds(ctx.app)

  const summary = await popup.evaluate<Record<string, { close: string | null }>>(`(() => {
    const out = {}
    for (const li of document.querySelectorAll('.downloads-item')) {
      const name = (li.querySelector('.downloads-item-name')?.textContent || '').trim()
      const closeBtn = li.querySelector('.downloads-item-close')
      out[name] = {
        close: closeBtn ? (closeBtn.getAttribute('aria-label') || '').toLowerCase() : null,
      }
    }
    return out
  })()`)

  expect(summary['dl.safetensors']?.close).toContain('cancel')
  expect(summary['pa.safetensors']?.close).toContain('cancel')
  expect(summary['pe.safetensors']?.close).toContain('cancel')
  expect(summary['co.safetensors']?.close).toContain('remove')
  expect(summary['er.safetensors']?.close).toContain('remove')
  expect(summary['ca.safetensors']?.close).toContain('remove')
})

test('retry affordance shows on error + cancelled rows only @windows @macos @linux', async () => {
  await seedDownloads(ctx.app, {
    active: [
      makeEntry({ url: 'u-dl', filename: 'dl.safetensors', status: 'downloading', progress: 0.5 })
    ],
    recent: [
      makeEntry({
        url: 'u-co',
        filename: 'co.safetensors',
        status: 'completed',
        progress: 1,
        savePath: '/tmp/co.safetensors'
      }),
      makeEntry({
        url: 'u-er',
        filename: 'er.safetensors',
        status: 'error',
        progress: 0,
        error: 'boom'
      }),
      makeEntry({ url: 'u-ca', filename: 'ca.safetensors', status: 'cancelled', progress: 0 })
    ]
  })
  await openDownloadsTray(ctx.titleBar)
  await waitForPopupVisible(ctx.app)
  await waitForStableBounds(ctx.app)

  const summary = await popup.evaluate<Record<string, { retry: boolean }>>(`(() => {
    const out = {}
    for (const li of document.querySelectorAll('.downloads-item')) {
      const name = (li.querySelector('.downloads-item-name')?.textContent || '').trim()
      out[name] = { retry: !!li.querySelector('.downloads-item-retry') }
    }
    return out
  })()`)

  expect(summary['er.safetensors']?.retry).toBe(true)
  expect(summary['ca.safetensors']?.retry).toBe(true)
  expect(summary['co.safetensors']?.retry).toBe(false)
  expect(summary['dl.safetensors']?.retry).toBe(false)
})

test('unseen failure shows the red error badge, not the green one @windows @macos @linux', async () => {
  await seedDownloads(ctx.app, {
    active: [],
    recent: [
      makeEntry({
        url: 'u-er',
        filename: 'er.safetensors',
        status: 'error',
        progress: 0,
        error: 'boom'
      })
    ]
  })

  await expect
    .poll(() => ctx.titleBar.count('.title-downloads-badge.is-error'), {
      timeout: 5_000,
      intervals: [100, 200, 400]
    })
    .toBe(1)
  expect(await ctx.titleBar.count('.title-downloads-badge.is-unseen')).toBe(0)
})

test('a completed-only download shows the green badge (error badge gated) @windows @macos @linux', async () => {
  await seedDownloads(ctx.app, {
    active: [],
    recent: [
      makeEntry({
        url: 'u-co',
        filename: 'co.safetensors',
        status: 'completed',
        progress: 1,
        savePath: '/tmp/co.safetensors'
      })
    ]
  })

  await expect
    .poll(() => ctx.titleBar.count('.title-downloads-badge.is-unseen'), {
      timeout: 5_000,
      intervals: [100, 200, 400]
    })
    .toBe(1)
  expect(await ctx.titleBar.count('.title-downloads-badge.is-error')).toBe(0)
})

test('a mid-batch failure shows the red dot while the active count badge persists @windows @macos @linux', async () => {
  await closeTitlePopupIfOpen(ctx.app)
  await new Promise((r) => setTimeout(r, TITLE_REOPEN_SUPPRESSION_MS))
  await seedDownloads(ctx.app, {
    active: [
      makeEntry({
        url: 'u-midbatch-dl1',
        filename: 'dl1.safetensors',
        status: 'downloading',
        progress: 0.5
      }),
      makeEntry({
        url: 'u-midbatch-dl2',
        filename: 'dl2.safetensors',
        status: 'downloading',
        progress: 0.2
      })
    ],
    recent: [
      makeEntry({
        url: 'u-midbatch-er',
        filename: 'er.safetensors',
        status: 'error',
        progress: 0,
        error: 'boom'
      })
    ]
  })

  await expect
    .poll(() => ctx.titleBar.count('.title-downloads-error-dot'), {
      timeout: 5_000,
      intervals: [100, 200, 400]
    })
    .toBe(1)
  expect(await ctx.titleBar.count('.title-downloads-tray.has-error')).toBe(1)
  expect(await ctx.titleBar.count('.title-downloads-badge.is-error')).toBe(0)
  const badgeText = (await ctx.titleBar.allText('.title-downloads-badge'))[0]?.trim()
  expect(badgeText).toBe('2')
})

test('the open popup repaints live when tray state changes @windows @macos @linux', async () => {
  await openDownloadsTray(ctx.titleBar)
  await waitForPopupVisible(ctx.app)
  await waitForStableBounds(ctx.app)

  expect(await popup.count('.downloads-item')).toBe(0)

  await seedDownloads(ctx.app, {
    active: [
      makeEntry({
        url: 'u-live',
        filename: 'live.safetensors',
        status: 'downloading',
        progress: 0.25
      })
    ],
    recent: []
  })
  await expect
    .poll(() => popup.count('.downloads-item'), {
      timeout: 5_000,
      intervals: [100, 200, 400]
    })
    .toBe(1)

  await seedDownloads(ctx.app, {
    active: [
      makeEntry({
        url: 'u-live',
        filename: 'live.safetensors',
        status: 'downloading',
        progress: 0.5
      }),
      makeEntry({
        url: 'u-live2',
        filename: 'live2.safetensors',
        status: 'downloading',
        progress: 0.1,
        createdAt: 2
      })
    ],
    recent: []
  })
  await expect
    .poll(() => popup.count('.downloads-item'), {
      timeout: 5_000,
      intervals: [100, 200, 400]
    })
    .toBe(2)
})

test('View All Downloads opens the full downloads popup with the seeded rows @windows @macos @linux', async () => {
  await seedDownloads(ctx.app, {
    active: [
      makeEntry({ url: 'u-dl', filename: 'dl.safetensors', status: 'downloading', progress: 0.5 })
    ],
    recent: [
      makeEntry({
        url: 'u-co',
        filename: 'co.safetensors',
        status: 'completed',
        progress: 1,
        savePath: '/tmp/co.safetensors'
      }),
      makeEntry({
        url: 'u-er',
        filename: 'er.safetensors',
        status: 'error',
        progress: 0,
        error: 'boom'
      })
    ]
  })
  await openFullDownloadsPopup()

  expect(await popup.count('.downloads')).toBe(0)
  await expect
    .poll(() => popup.count('.dlm-row'), {
      timeout: 5_000,
      intervals: [100, 200, 400]
    })
    .toBe(3)

  expect(await popup.count('.dlm-filter-chip')).toBeGreaterThan(0)
  expect(await popup.count('.dlm-footer')).toBe(1)
})

test('the full downloads popup shows the empty state when nothing is seeded @windows @macos @linux', async () => {
  await openFullDownloadsPopup()

  expect(await popup.count('.dlm-empty')).toBe(1)
  expect(await popup.count('.dlm-row')).toBe(0)
  expect(await popup.count('.dlm-footer')).toBe(0)
})

function makeEntry(
  partial: Partial<DownloadProgressLike> & { url: string; filename: string }
): DownloadProgressLike {
  return {
    progress: 0,
    status: 'downloading',
    createdAt: ++entryCounter,
    ...partial
  }
}

async function waitForPopupVisible(app: ElectronApplication): Promise<void> {
  await expect
    .poll(() => isPopupVisible(app, 'comfyTitlePopup.html'), {
      timeout: 5_000,
      intervals: [100, 200]
    })
    .toBe(true)
}

async function openFullDownloadsPopup(): Promise<void> {
  await openDownloadsTray(ctx.titleBar)
  await waitForPopupVisible(ctx.app)
  await popup.waitForSelector('.downloads-link', { timeout: 5_000 })
  await waitForStableBounds(ctx.app)
  expect(await popup.clickByText('.downloads-link', 'View All')).toBe(true)
  await popup.waitForSelector('.dlm-panel', { timeout: 5_000 })
}

async function waitForStableBounds(
  app: ElectronApplication,
  opts: { timeoutMs?: number; settleMs?: number } = {}
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 3_000
  const settleMs = opts.settleMs ?? 250
  const deadline = Date.now() + timeoutMs
  let lastH = -1
  let lastChange = Date.now()
  while (Date.now() < deadline) {
    const bounds = await getTitlePopupBounds(app)
    const h = bounds?.bounds.height ?? 0
    if (h !== lastH) {
      lastH = h
      lastChange = Date.now()
    } else if (Date.now() - lastChange >= settleMs) {
      return
    }
    await new Promise((r) => setTimeout(r, 50))
  }
}
