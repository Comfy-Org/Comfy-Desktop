import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'

const MARKER_FILENAME = '.comfyui-desktop-2'
const LOCAL_BUILDS = [
  { id: 'inst-home-narrow-a', name: 'Narrow One' },
  { id: 'inst-home-narrow-b', name: 'Narrow Two' }
]

let ctx: AppContext
const installPaths: string[] = []

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  for (const build of LOCAL_BUILDS) {
    const installPath = await mkdtemp(path.join(os.tmpdir(), 'comfyui-launcher-home-narrow-e2e-'))
    await writeFile(path.join(installPath, MARKER_FILENAME), build.id)
    installPaths.push(installPath)
  }
  ctx = await launchApp(
    {
      settings: { firstUseCompleted: true, telemetryEnabled: false },
      installations: LOCAL_BUILDS.map((build, index) => ({
        ...build,
        installPath: installPaths[index]!,
        sourceId: 'standalone',
        status: 'installed'
      }))
    },
    { stayOnHome: true }
  )
  await ctx.panel.waitForVisible('[data-testid="home-builds"]')
})

test.afterAll(async () => {
  await ctx?.cleanup()
  for (const installPath of installPaths) await rm(installPath, { recursive: true, force: true })
})

interface BuildsLayout {
  total: number
  firstText: string
  visible: string[]
  columns: number
}

function layoutAtWidth(width: string): Promise<BuildsLayout> {
  return ctx.panel.evaluate<BuildsLayout>(`(async () => {
    const section = document.querySelector('[data-testid="home-builds"]')
    section.style.width = '${width}'
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const items = [...section.querySelectorAll('li')]
    const list = section.querySelector('ul')
    return {
      total: items.length,
      firstText: items[0].innerText,
      visible: items.filter((item) => getComputedStyle(item).display !== 'none').map((item) => item.innerText),
      columns: getComputedStyle(list).gridTemplateColumns.split(' ').length
    }
  })()`)
}

test('A narrow Home shows the latest build and Cloud in two columns @windows @macos @linux', async () => {
  const layout = await layoutAtWidth('700px')

  expect(layout.total).toBe(3)
  expect(layout.columns).toBe(2)
  expect(layout.visible).toHaveLength(2)
  expect(layout.visible).toContain(layout.firstText)
  expect(layout.visible.some((text) => text.includes('Comfy Cloud'))).toBe(true)
})

test('A wide Home shows every build in three columns @windows @macos @linux', async () => {
  const layout = await layoutAtWidth('1000px')

  expect(layout.columns).toBe(3)
  expect(layout.visible).toHaveLength(3)
})
