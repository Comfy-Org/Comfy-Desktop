/* global document */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { chromium } from 'playwright'

export const REPO = resolve(fileURLToPath(import.meta.url), '../../..')
export const OUT_ROOT = resolve(REPO, 'design-shots')

export const ALL_DIRECTIONS = ['original', 'a', 'b', 'c']
export const ALL_THEMES = ['dark', 'light']

/** `--key value` and `--flag` pairs from the command line. */
export function parseArgs(argv = process.argv.slice(2)) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) args[key] = true
    else args[key] = argv[++i]
  }
  return args
}

export function list(value, fallback) {
  return typeof value === 'string' ? value.split(',').map((v) => v.trim()) : fallback
}

export function outDir(...parts) {
  const dir = resolve(OUT_ROOT, ...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Starts the prototype's dev server and a headless browser. */
export async function startPreview() {
  const server = await createServer({
    configFile: resolve(REPO, 'scripts/design/vite.config.mjs'),
    server: { port: 0, open: false },
    logLevel: 'error'
  })
  await server.listen()
  const url = server.resolvedUrls.local[0].replace(/\/$/, '')
  const browser = await chromium.launch({ executablePath: process.env.DESIGN_CHROME || undefined })
  return {
    browser,
    async open({ direction, theme, milestone }) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce'
      })
      if (milestone !== undefined) {
        await context.addInitScript(
          (m) => sessionStorage.setItem('comfy.design.milestone', m),
          String(milestone)
        )
      }
      const page = await context.newPage()
      await page.goto(`${url}/design-landing.html?direction=${direction}&theme=${theme}`, {
        waitUntil: 'networkidle'
      })
      await page.evaluate(() => document.fonts.ready)
      return page
    },
    async close() {
      await browser.close()
      await server.close()
    }
  }
}
