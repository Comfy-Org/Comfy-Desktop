import { afterAll, describe, expect, it } from 'vitest'
import { launchPreviewBrowser, listScenarios, openPreviewPage, showScenario } from './browser.mjs'
import { startPreviewServer } from './server.mjs'

const PLATFORMS = ['darwin', 'win32', 'linux']

const server = await startPreviewServer()
const browser = await launchPreviewBrowser()
const index = await openPreviewPage(browser)
const scenarios = await listScenarios(index.page, server.url)
await index.close()

afterAll(async () => {
  await browser.close()
  await server.close()
})

describe('the renderer preview', () => {
  it('lists its scenarios on the index page', () => {
    expect(scenarios).toContain('first-use')
    expect(scenarios).toContain('home')
  })

  describe.each(scenarios)('scenario %s', (scenario) => {
    it.each(PLATFORMS)('draws on %s with no page error', { timeout: 60_000 }, async (platform) => {
      const { page, problems, close } = await openPreviewPage(browser)
      try {
        await showScenario(page, server.url, scenario, platform)
        expect(problems).toEqual([])
      } finally {
        await close()
      }
    })
  })
})
