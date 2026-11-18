import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  DEFAULT_VIEWPORT,
  launchPreviewBrowser,
  listScenarios,
  openPreviewPage,
  showScenario
} from './browser.mjs'
import { startPreviewServer } from './server.mjs'

const { values } = parseArgs({
  options: {
    scenario: { type: 'string', multiple: true },
    platform: { type: 'string', multiple: true, default: ['darwin'] },
    size: { type: 'string', default: `${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height}` },
    out: { type: 'string', default: 'preview-shots' }
  }
})

const [width, height] = values.size.split('x').map(Number)
if (!width || !height) throw new Error(`--size takes WIDTHxHEIGHT, got ${values.size}`)

const outDir = path.resolve(values.out)
fs.mkdirSync(outDir, { recursive: true })

const server = await startPreviewServer()
const browser = await launchPreviewBrowser()
let failed = false

try {
  const index = await openPreviewPage(browser)
  const known = await listScenarios(index.page, server.url)
  await index.close()

  const wanted = values.scenario ?? known
  const unknown = wanted.filter((id) => !known.includes(id))
  if (unknown.length) {
    throw new Error(`No scenario named ${unknown.join(', ')}. There are: ${known.join(', ')}`)
  }

  for (const platform of values.platform) {
    for (const scenario of wanted) {
      const file = path.join(outDir, `${scenario}.${platform}.png`)
      const { page, problems, close } = await openPreviewPage(browser, { width, height })
      try {
        await showScenario(page, server.url, scenario, platform)
        await page.screenshot({ path: file })
        console.log(`${path.relative(process.cwd(), file)}`)
        for (const problem of problems) console.warn(`  page error: ${problem}`)
      } catch (error) {
        failed = true
        await page.screenshot({ path: file.replace(/\.png$/, '.failed.png') })
        console.error(`${scenario} (${platform}) did not draw: ${error.message}`)
        for (const problem of problems) console.error(`  page error: ${problem}`)
      } finally {
        await close()
      }
    }
  }
} finally {
  await browser.close()
  await server.close()
}

if (failed) process.exitCode = 1
