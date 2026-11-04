import { startPreview } from './preview.mjs'
// Opens each menu of Mar's proposal on a fresh page and screenshots it.
const out = process.argv[2]
const themes = (process.argv[3] || 'dark,light').split(',')
const steps = JSON.parse(process.argv[4] || '[]')
const p = await startPreview()
for (const theme of themes) {
  let page
  for (let i = 0; i < 4; i++) { try { page = await p.open({ direction: 'original', theme, milestone: 10 }); break } catch (e) { console.log('retry') } }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const url = page.url()
  for (const [name, clicks] of steps) {
    try {
      await page.goto(url); await page.waitForTimeout(6000)
      for (const [sel, text, nth] of clicks) {
        const l = text ? page.locator(sel, { hasText: text }) : page.locator(sel)
        await (nth === -1 ? l.last() : l.first()).click({ timeout: 4000 }); await page.waitForTimeout(700)
      }
      await page.screenshot({ path: `${out}/${name}-${theme}.png` })
    } catch (e) { console.log('fail', name, theme, e.message.split('\n')[0]) }
  }
}
process.exit(0)
