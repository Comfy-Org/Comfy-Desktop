/* global document */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { OUT_ROOT, parseArgs } from './preview.mjs'

/**
 * The sidebar's "Log in" card in Mar's proposal, signed out, dark and
 * light, against the running dev server.
 *
 *   node scripts/design/mar-signin-shots.mjs --name before
 *   --url http://localhost:5173
 */
const args = parseArgs()
const name = typeof args.name === 'string' ? args.name : 'latest'
const base = typeof args.url === 'string' ? args.url : 'http://localhost:5173'
const dir = resolve(OUT_ROOT, 'mar-signin', name)
mkdirSync(dir, { recursive: true })

const browser = await chromium.launch({ executablePath: process.env.DESIGN_CHROME || undefined })
const shoot = async (theme, collapsed) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce'
  })
  await context.addInitScript(
    (c) =>
      localStorage.setItem(
        'comfy.design.mar.nav.v3',
        JSON.stringify({ id: 'panels', collapsed: c })
      ),
    collapsed
  )
  const page = await context.newPage()
  await page.goto(`${base}/design-landing.html?signedOut=1&theme=${theme}`, {
    waitUntil: 'networkidle'
  })
  await page.evaluate(() => document.fonts.ready)
  const tag = `${theme}${collapsed ? '-rail' : ''}`
  const side = await page.locator('.proto-sidebar').first().boundingBox()
  const pad = 24
  const clipAbove = async (card, file) => {
    const box = await card.boundingBox()
    await page.screenshot({
      path: resolve(dir, file),
      clip: {
        x: side.x,
        y: Math.max(0, box.y - 120),
        width: side.width + pad,
        height: box.height + 120 + pad
      }
    })
  }
  if (collapsed) {
    await page.screenshot({
      path: resolve(dir, `${tag}.png`),
      clip: { x: 0, y: 500, width: side.x + side.width + pad, height: 400 }
    })
  } else {
    // Mar's card, or Pablo's (the text's parent) before it existed.
    const card = page
      .locator('.mar-signin')
      .or(page.getByText('Log in to Comfy').locator('..'))
      .first()
    await card.waitFor()
    await clipAbove(card, `${tag}.png`)
    await card.hover()
    await page.waitForTimeout(700)
    await clipAbove(card, `${tag}-hover.png`)
  }
  await page.screenshot({ path: resolve(dir, `${tag}-full.png`) })
  await context.close()
  process.stdout.write('.')
}
for (const theme of ['dark', 'light']) {
  await shoot(theme, false)
  await shoot(theme, true)
}
await browser.close()
process.stdout.write(`\n${dir}\n`)
