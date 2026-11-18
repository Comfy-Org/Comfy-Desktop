import { chromium } from 'playwright'

const READY_TIMEOUT_MS = 30_000

function isFontThisCheckoutDoesNotHave(url) {
  return new URL(url || 'about:blank').pathname.startsWith('/fonts/')
}

export const DEFAULT_VIEWPORT = { width: 1280, height: 800 }

export async function launchPreviewBrowser() {
  return chromium.launch({ headless: true })
}

export async function openPreviewPage(browser, viewport = DEFAULT_VIEWPORT) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    reducedMotion: 'reduce'
  })
  const page = await context.newPage()
  const problems = []
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) problems.length = 0
  })
  page.on('pageerror', (error) => problems.push(error.message))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const source = message.location().url
    if (isFontThisCheckoutDoesNotHave(source)) return
    problems.push(source ? `${message.text()} (${source})` : message.text())
  })
  return { page, problems, close: () => context.close() }
}

export async function listScenarios(page, previewUrl) {
  await page.goto(previewUrl)
  await page.waitForSelector('html[data-preview-ready="index"]', { timeout: READY_TIMEOUT_MS })
  return page.$$eval('[data-scenario]', (rows) => rows.map((row) => row.dataset.scenario))
}

export async function showScenario(page, previewUrl, scenario, platform) {
  await page.goto(`${previewUrl}?scenario=${scenario}&platform=${platform}`)
  await page.waitForSelector('html[data-preview-ready], html[data-preview-failed]', {
    timeout: READY_TIMEOUT_MS
  })
  const failure = await page.locator('html').getAttribute('data-preview-failed')
  if (failure) throw new Error(failure)
}
