import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'

const SIDEBAR_ASSETS = '[data-testid="app-sidebar-assets"]'
const ASSETS_GRID = '[data-testid="assets-grid"]'
const SAMPLE_IMAGE = path.resolve('src/renderer/src/assets/sidebar/hills-sunset.jpg')
const SAMPLE_VIDEO = path.resolve('src/renderer/public/install-showcase-scene/Assets/earpods.webm')
const SAMPLE_VIDEO_SHAPE = 714 / 530

let ctx: AppContext
let outputDir: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  outputDir = await mkdtemp(path.join(os.tmpdir(), 'comfy-assets-output-'))
  await mkdir(path.join(outputDir, 'landscapes'), { recursive: true })
  await copyFile(SAMPLE_IMAGE, path.join(outputDir, 'landscapes', 'ComfyUI_00001_.jpg'))
  await copyFile(SAMPLE_VIDEO, path.join(outputDir, 'ComfyUI_00002_.webm'))
  ctx = await launchApp(
    { settings: { firstUseCompleted: true, telemetryEnabled: false, outputDir } },
    { stayOnHome: true }
  )
})

test.afterAll(async () => {
  await ctx.cleanup()
  await rm(outputDir, { recursive: true, force: true })
})

test('Assets shows the images in the output folder with no build running and no login @windows @macos @linux', async () => {
  expect(await ctx.panel.click(SIDEBAR_ASSETS)).toBe(true)

  await ctx.panel.waitForVisible(ASSETS_GRID)
  await expect
    .poll(
      () =>
        ctx.panel.evaluate<boolean>(
          `(() => {
          const img = document.querySelector('${ASSETS_GRID} img')
          return !!img && img.complete && img.naturalWidth > 0
        })()`
        ),
      { message: 'the first image from disk loads', timeout: 20_000 }
    )
    .toBe(true)
  const src = await ctx.panel.evaluate<string>(
    `document.querySelector('${ASSETS_GRID} img').getAttribute('src')`
  )
  expect(src.startsWith('comfy-output://file/')).toBe(true)
  expect(decodeURIComponent(src)).toContain('ComfyUI_00001_.jpg')
})

test('A video in the output folder keeps its shape and shows how long it runs @windows @macos @linux', async () => {
  const lengthLabel = `document.querySelector('${ASSETS_GRID} [data-testid="asset-duration"]')`
  await expect
    .poll(() => ctx.panel.evaluate<string | null>(`${lengthLabel}?.textContent?.trim() ?? null`), {
      message: 'the video card shows its length, read from the file',
      timeout: 20_000
    })
    .toBe('0:08')
  const shape = await ctx.panel.evaluate<number>(
    `(() => { const box = ${lengthLabel}.parentElement.getBoundingClientRect(); return box.width / box.height })()`
  )
  expect(shape, 'the card has the video shape, not a 16:9 crop').toBeCloseTo(SAMPLE_VIDEO_SHAPE, 1)
})

test('A stopped build shows its recorded outputs and the computer view keeps other files @windows @macos @linux', async () => {
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'comfy-output-provenance-'))
  let app: AppContext | undefined
  try {
    const shared = await realpath(await mkdtemp(path.join(profileDir, 'output-')))
    const recorded = [
      { id: 'producer-a', name: 'Build A', file: path.join(shared, 'one.jpg') },
      { id: 'producer-b', name: 'Build B', file: path.join(shared, 'two.jpg') }
    ]
    await Promise.all(
      [...recorded.map(({ file }) => file), path.join(shared, 'older.jpg')].map((file) =>
        copyFile(SAMPLE_IMAGE, file)
      )
    )
    app = await launchApp(
      {
        profileDir,
        settings: { firstUseCompleted: true, telemetryEnabled: false, outputDir: shared },
        installations: recorded.map(({ id, name }) => ({ id, name, useSharedOutput: true })),
        async onSetup({ homeDir, appDataDir }) {
          const state =
            process.platform === 'linux'
              ? path.join(homeDir, '.local', 'state', 'comfyui-desktop-2')
              : appDataDir
          for (const { id, file } of recorded) {
            const dir = path.join(
              state,
              'output-provenance',
              createHash('sha256').update(id).digest('hex')
            )
            const info = await stat(file, { bigint: true })
            await mkdir(dir, { recursive: true })
            await writeFile(
              path.join(dir, '1-012345678901234567890123456789ab.jsonl'),
              JSON.stringify({
                version: 1,
                producer_id: id,
                job_id: 'saved-job',
                path: file,
                device: BigInt.asUintN(64, info.dev).toString(),
                inode: BigInt.asUintN(64, info.ino).toString(),
                size: info.size.toString(),
                mtime_ns: info.mtimeNs.toString()
              }) +
                '\n' +
                (id === 'producer-b' ? JSON.stringify({ version: 2, producer_id: id }) + '\n' : '')
            )
          }
        }
      },
      { stayOnHome: true }
    )
    const panel = app.panel
    expect(await panel.click(SIDEBAR_ASSETS)).toBe(true)
    const picker = '[data-testid="assets-build-picker"]'
    const card = '[data-testid^="asset-open-"]'
    const select = async (id: string): Promise<void> => {
      expect(await panel.click(picker)).toBe(true)
      expect(await panel.click(`[data-testid="assets-build-${id}"]`)).toBe(true)
    }
    const names = (): Promise<Array<string | null>> =>
      panel.evaluate(
        `Array.from(document.querySelectorAll('${card}'), card => card.getAttribute('aria-label')).sort()`
      )

    await select('producer-a')
    await expect.poll(names).toEqual(['Inspect one.jpg'])
    expect(await panel.click(card)).toBe(true)
    await panel.waitForVisible('[data-testid="output-detail-path"]')
    expect(
      await panel.evaluate(
        'document.querySelector(\'[data-testid="output-detail-path"] p\').textContent'
      )
    ).toBe(recorded[0]!.file)
    expect(await panel.click('[data-testid="output-detail-close"]')).toBe(true)
    await select('producer-b')
    await expect.poll(names).toEqual(['Inspect two.jpg'])
    await panel.waitForVisible('[data-testid="assets-provenance-warning"]')
    await select('local')
    await expect.poll(names).toEqual(['Inspect older.jpg', 'Inspect one.jpg', 'Inspect two.jpg'])
  } finally {
    await app?.cleanup()
    await rm(profileDir, { recursive: true, force: true })
  }
})
