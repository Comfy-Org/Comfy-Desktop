import { startPreview } from './preview.mjs'
// node scripts/design/.deploy-shot.mjs [states]
const all = ['configure','needs-publish','uploading','release-failed','no-capacity','insufficient-credits','plan-limit','signed-out','ready','stopped','stopped-credits','updating']
const states = process.argv[2] ? process.argv[2].split(',') : [...all, 'flow-progress', 'key-created', 'test-run', 'python']
const out = 'design-shots/deploy'
const p = await startPreview()
for (const theme of ['dark', 'light']) {
  let page
  for (let i = 0; i < 4; i++) { try { page = await p.open({ direction: 'original', theme, milestone: 10 }); break } catch { console.log('retry') } }
  await page.goto(page.url()); await page.waitForTimeout(2500)
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const st of states) {
    const base = all.includes(st) ? st : st === 'flow-progress' ? 'needs-publish' : 'ready'
    await page.evaluate(async (s) => {
      const m = await import('/src/design/landing/useProto.ts')
      if (!m.proto.deploying) { m.proto.deploying = 'local-1'; await new Promise((r) => setTimeout(r, 400)) }
    })
    await page.waitForTimeout(300)
    await page.locator('.mar-dep-dev select').selectOption(base)
    await page.waitForTimeout(500)
    if (st === 'flow-progress') { await page.locator('[data-dep-primary]').click(); await page.waitForTimeout(700) }
    if (st === 'key-created') { await page.getByText('New API key').click(); await page.locator('.mar-dep-newkey button').click(); await page.waitForTimeout(300) }
    if (st === 'test-run') { await page.locator('.mar-dep-test button').click(); await page.waitForTimeout(1800) }
    if (st === 'python') { await page.getByRole('tab', { name: 'Python' }).click(); await page.waitForTimeout(200) }
    await page.mouse.move(5, 5)
    await page.screenshot({ path: `${out}/${st}-${theme}.png` })
  }
}
await p.close(); process.exit(0)
