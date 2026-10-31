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
for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce'
  })
  await context.addInitScript(() =>
    localStorage.setItem('comfy.design.mar.nav.v3', JSON.stringify({ id: 'panels' }))
  )
  const page = await context.newPage()
  await page.goto(`${base}/design-landing.html?proposal=mariana&signedOut=1&theme=${theme}`, {
    waitUntil: 'networkidle'
  })
  await page.evaluate(() => document.fonts.ready)
  // Mar's card, or Pablo's (the text's parent) before it existed.
  const card = page.locator('.mar-signin').or(page.getByText('Log in to Comfy').locator('..')).first()
  await card.waitFor()
  const box = await card.boundingBox()
  const side = await page.locator('.proto-sidebar').first().boundingBox()
  const pad = 24
  await page.screenshot({
    path: resolve(dir, `${theme}.png`),
    clip: {
      x: side.x,
      y: Math.max(0, box.y - 120),
      width: side.width + pad,
      height: box.height + 120 + pad
    }
  })
  await page.screenshot({ path: resolve(dir, `${theme}-full.png`) })
  await context.close()
  process.stdout.write('.')
}
await browser.close()
process.stdout.write(`\n${dir}\n`)
