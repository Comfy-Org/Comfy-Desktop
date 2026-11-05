// The Floating panels sidebar head, open and collapsed, to design-shots/sidebar-top/.
import { chromium } from 'playwright'
import { outDir } from './preview.mjs'

const dir = outDir('sidebar-top')
const browser = await chromium.launch()
try {
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      reducedMotion: 'reduce'
    })
    await ctx.addInitScript(() => {
      sessionStorage.setItem('comfy.design.milestone', '10')
      localStorage.setItem('comfy.design.mar.sideHead', 'brand')
      localStorage.setItem(
        'comfy.design.mar.user',
        JSON.stringify({ user: 'returning', local: 'several' })
      )
    })
    const p = await ctx.newPage()
    await p.goto(
      `http://localhost:5173/design-landing.html?direction=original&theme=${theme}`,
      { waitUntil: 'load', timeout: 90000 }
    )
    await p.waitForTimeout(2500)
    await p.screenshot({
      path: `${dir}/${theme}-open.png`,
      clip: { x: 0, y: 0, width: 700, height: 900 }
    })
    const t = p.locator('.mar-panels-toggle').first()
    if (await t.count()) {
      await t.click()
      await p.waitForTimeout(600)
      await p.screenshot({
        path: `${dir}/${theme}-closed.png`,
        clip: { x: 0, y: 0, width: 700, height: 900 }
      })
      await p.locator('.mar-panels-toggle').first().click()
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}
