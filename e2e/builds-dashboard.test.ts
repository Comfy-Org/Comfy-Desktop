/**
 * E2E: the Builds dashboard (redesign Milestone 2).
 *
 * Seeds a local build whose folders hold a workflow, a model, a custom node
 * pack and an output image, plus a signed-out Comfy Cloud build, and walks the
 * sidebar, All builds, the build page and its four tabs. Every list is read
 * from the seeded files through main; the image is served by comfy-media://.
 */
import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp } from './launchApp'
import type { AppContext } from './launchApp'

let ctx: AppContext
let installPath: string

const LOCAL_ID = 'inst-builds-dash-local'
const LOCAL_NAME = 'Dashboard Studio'
const CLOUD_ID = 'inst-builds-dash-cloud'
const CLOUD_NAME = 'Comfy Cloud'
const MARKER_FILENAME = '.comfyui-desktop-2'
/** A 1x1 transparent PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

async function seedFile(relativePath: string, content: string | Buffer = ''): Promise<void> {
  const file = path.join(installPath, 'ComfyUI', relativePath)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
}

/** Reka tabs activate on mouse-down, not click. */
async function openTab(label: string): Promise<void> {
  const found = await ctx.panel.evaluate<boolean>(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.includes(${JSON.stringify(label)}))
    tab?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    return !!tab
  })()`)
  expect(found, `tab "${label}"`).toBe(true)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-builds-dash-'))
  await writeFile(path.join(installPath, MARKER_FILENAME), LOCAL_ID)
  await seedFile('user/default/workflows/e2e-portrait.json', '{}')
  await seedFile('models/checkpoints/e2e-model.safetensors', 'x')
  await seedFile('custom_nodes/e2e-pack/__init__.py', '')
  await seedFile('output/e2e-image.png', PNG)

  ctx = await launchApp({
    settings: { firstUseCompleted: true, telemetryEnabled: false, newDashboardEnabled: true },
    installations: [
      { id: LOCAL_ID, name: LOCAL_NAME, installPath, sourceId: 'standalone', status: 'installed' },
      { id: CLOUD_ID, name: CLOUD_NAME, sourceId: 'cloud', status: 'installed' }
    ]
  })
  await ctx.panel.waitForSelector('[data-testid="builds-dashboard"]', { timeout: 15_000 })
})

test.afterAll(async () => {
  try {
    if (ctx) await ctx.cleanup()
  } finally {
    if (installPath) await rm(installPath, { recursive: true, force: true })
  }
})

test('lists the builds in the sidebar and on All builds @windows @macos @linux', async () => {
  await ctx.panel.waitForSelector(`[data-testid="dashboard-sidebar-build-${LOCAL_ID}"]`)
  expect(await ctx.panel.textOf(`[data-testid="dashboard-sidebar-build-${CLOUD_ID}"]`)).toContain(
    CLOUD_NAME
  )
  // Exactly two builds: the count ends the row's text.
  await expect
    .poll(() => ctx.panel.textOf('[data-testid="dashboard-all-builds"]'))
    .toMatch(/(^|\D)2$/)
  expect(await ctx.panel.exists(`[data-testid="dashboard-card-${LOCAL_ID}"]`)).toBe(true)
})

test('opens a build page with its saved workflows @windows @macos @linux', async () => {
  await ctx.panel.click(`[data-testid="dashboard-card-${LOCAL_ID}"]`)
  await ctx.panel.waitForSelector('[data-testid="dashboard-workflows"]')
  expect(await ctx.panel.textOf('h1')).toBe(LOCAL_NAME)
  expect(await ctx.panel.textOf('[data-testid="dashboard-workflows"]')).toContain('e2e-portrait')
})

test("lists the build's models and custom nodes @windows @macos @linux", async () => {
  await openTab('Models')
  await ctx.panel.waitForSelector('[data-testid="dashboard-models"]')
  await expect
    .poll(() => ctx.panel.textOf('[data-testid="dashboard-models"]'))
    .toContain('e2e-model.safetensors')
  await openTab('Custom nodes')
  await ctx.panel.waitForSelector('[data-testid="dashboard-nodes"]')
  await expect
    .poll(() => ctx.panel.textOf('[data-testid="dashboard-nodes"]'))
    .toContain('e2e-pack')
})

test("shows the build's outputs through comfy-media @windows @macos @linux", async () => {
  await openTab('Assets')
  await ctx.panel.waitForSelector('[data-testid="dashboard-assets"] img')
  await expect
    .poll(() =>
      ctx.panel.evaluate<number>(
        `document.querySelector('[data-testid="dashboard-assets"] img')?.naturalWidth ?? 0`
      )
    )
    .toBe(1)
})

test('asks a signed-out user to log in on a Comfy Cloud build @windows @macos @linux', async () => {
  await ctx.panel.click(`[data-testid="dashboard-sidebar-build-${CLOUD_ID}"]`)
  await ctx.panel.waitForSelector('[data-testid="dashboard-launch"]')
  await expect.poll(() => ctx.panel.textOf('main')).toContain('Log in to see this build')
})
