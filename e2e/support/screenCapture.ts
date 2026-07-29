/**
 * Screenshot harness behind the opt-in `capture` Playwright project.
 *
 * One PNG per surface via `webContents.capturePage()`, driven through
 * `app.evaluate`. There is no single full-window shot to take: the host
 * BrowserWindow has no DOM of its own — the title bar and the panel are sibling
 * WebContentsViews composited natively (`src/main/host/createHostWindow.ts`), so
 * `BrowserWindow.capturePage()` would hand back a blank plate. The image crosses
 * the Playwright bridge as base64 because a Buffer does not survive it.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, type ElectronApplication } from '@playwright/test'
import { findWebContentsId, WebContentsPage } from './cdpPages'

/** Canonical chooser host size — `DEFAULT_HOST_WIDTH` / `DEFAULT_HOST_HEIGHT`
 *  in `src/main/host/createHostWindow.ts`. Every screen is shot at it. */
export const CAPTURE_CONTENT_WIDTH = 1280
export const CAPTURE_CONTENT_HEIGHT = 900

/** Stills the tile FLIP, the brand beams, the progress bar and the text caret,
 *  so the shutter can't land mid-frame and two runs agree. */
const FREEZE_CSS = `*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
}`

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CaptureTarget {
  /** Stable id; also the filename stem after the ordinal prefix. */
  id: string
  /** URL marker of the webContents the screen lives in. */
  surface: string
  /** Selector that must be visible before the shutter fires. */
  anchor: string
  /** Crop the shot to this element's box. Omit for the whole surface; set it
   *  when a screen would otherwise be pixel-identical to a wider one. */
  crop?: string
}

export interface CaptureRecord extends CaptureTarget {
  file: string
  /** Real PNG pixel size, read back out of the IHDR — on a HiDPI display this
   *  is `scaleFactor` times the CSS size, which is what Figma wants. */
  width: number
  height: number
  /** Native pixels per DIP for the run; 2 on a Retina display. */
  scaleFactor: number
}

export interface SkippedCapture {
  id: string
  reason: string
}

export interface CaptureManifest {
  createdAt: string
  platform: string
  contentSize: { width: number; height: number }
  captured: CaptureRecord[]
  skipped: SkippedCapture[]
  /** Distribution-install statuses the run seeded — declared by the caller,
   *  not observed here. */
  distributionStates: string[]
}

/** `captures/` at the repo root, or `COMFY_CAPTURE_DIR`. */
export function captureDir(): string {
  const override = process.env['COMFY_CAPTURE_DIR']
  return override ? path.resolve(override) : path.resolve(__dirname, '..', '..', 'captures')
}

/** Wipe and recreate, so a screen dropped from the declaration can't linger as
 *  a stale PNG beside the fresh set. */
export async function resetCaptureDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
}

/** Pin the host window to the canonical size so every PNG is the same shape,
 *  and read the scale those shots land at. */
function prepareHost(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ BrowserWindow, screen }, size) => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (!win) throw new Error('no host window to size')
    win.setContentSize(size.width, size.height)
    return screen.getDisplayMatching(win.getBounds()).scaleFactor
  }, { width: CAPTURE_CONTENT_WIDTH, height: CAPTURE_CONTENT_HEIGHT })
}

/**
 * Wait for a painted frame. A visible anchor only proves the DOM changed;
 * without this `capturePage` can hand back the previous screen, which is how
 * two adjacent states of one operation end up byte-identical. Raced against a
 * timeout because rAF stops firing on an occluded window and this must never
 * be the thing that hangs a run; a barrier that times out is logged so a
 * stale-frame run is visible after the fact.
 */
async function paintBarrier(page: WebContentsPage, id: string): Promise<void> {
  const painted = await page.evaluate<boolean>(`Promise.race([
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))),
    new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
  ])`)
  if (!painted) console.warn(`[capture] ${id}: no frame presented in 2s — this shot may be stale`)
}

/** The crop element's box in DIP, rounded outwards — `capturePage(rect)` wants
 *  integers and a fractional box would shave an edge pixel. Resolved as the
 *  anchor's nearest matching ancestor, so a shot always contains the element
 *  the shutter waited for. */
function cropRect(page: WebContentsPage, anchor: string, crop: string): Promise<CropRect | null> {
  return page.evaluate<CropRect | null>(`(() => {
    const el = document.querySelector(${JSON.stringify(anchor)})?.closest(${JSON.stringify(crop)})
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      x: Math.floor(r.left),
      y: Math.floor(r.top),
      width: Math.ceil(r.right) - Math.floor(r.left),
      height: Math.ceil(r.bottom) - Math.floor(r.top),
    }
  })()`)
}

/**
 * Shoots the declared screens and keeps the books. Every declared id must end
 * up either captured or skipped-with-a-reason; the caller asserts that, so a
 * renamed selector fails the run instead of silently emitting a short set.
 */
export class ScreenCapturer {
  readonly captured: CaptureRecord[] = []
  readonly skipped: SkippedCapture[] = []
  /** Surfaces already carrying the freeze rule; re-inserting is pointless. */
  private readonly frozen = new Set<string>()
  /** Last base64 shot per surface, to catch a repeated compositor frame. */
  private readonly lastShot = new Map<string, string>()

  /** Sizes the host once — the canonical size is a launch concern, not a
   *  per-shot one — and pins the scale every record reports. */
  static async create(
    app: ElectronApplication,
    outDir: string,
    declared: readonly CaptureTarget[],
  ): Promise<ScreenCapturer> {
    return new ScreenCapturer(app, outDir, declared, await prepareHost(app))
  }

  private constructor(
    private readonly app: ElectronApplication,
    private readonly outDir: string,
    /** Every screen the harness claims, in file order. */
    private readonly declared: readonly CaptureTarget[],
    /** Native pixels per DIP for this run; 2 on a Retina display. */
    private readonly scaleFactor: number,
  ) {}

  /** Wait for the screen's anchor, then write `NN-<id>.png`. */
  async capture(id: string): Promise<void> {
    const index = this.declared.findIndex((t) => t.id === id)
    const target = this.declared[index]
    if (!target) throw new Error(`capture "${id}" is not declared`)

    const page = new WebContentsPage(this.app, target.surface)
    await page.waitForVisible(target.anchor, { timeout: 20_000 })
    const wcId = await findWebContentsId(this.app, target.surface)
    if (wcId === null) throw new Error(`webContents not found (marker=${target.surface})`)

    await this.freeze(wcId, target.surface)
    await page.evaluate<boolean>('document.fonts.ready.then(() => true)')
    await paintBarrier(page, id)

    const rect = target.crop ? await cropRect(page, target.anchor, target.crop) : null
    if (target.crop) {
      expect(rect, `${id}: crop ${target.crop} is not an ancestor of ${target.anchor}`).not.toBeNull()
    }

    let shot = await this.shoot(wcId, rect)
    // Byte-identical to the last shot of this surface almost always means the
    // compositor hadn't presented the new state yet. Give it another frame and
    // re-shoot; a screen that genuinely repeats simply keeps the second shot.
    if (shot.png === this.lastShot.get(target.surface)) {
      await paintBarrier(page, id)
      shot = await this.shoot(wcId, rect)
    }
    this.lastShot.set(target.surface, shot.png)

    expect(shot.empty, `${id}: capturePage returned an empty NativeImage`).toBe(false)
    const png = Buffer.from(shot.png, 'base64')
    expect(
      png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
      `${id}: capturePage returned no PNG data`,
    ).toBe(true)
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    expect(Math.min(width, height), `${id}: capturePage returned a zero-sized image`).toBeGreaterThan(0)

    const file = `${String(index + 1).padStart(2, '0')}-${id}.png`
    await writeFile(path.join(this.outDir, file), png)

    this.captured.push({ ...target, file, width, height, scaleFactor: this.scaleFactor })
  }

  /** Record a screen this run could not reach, and why. */
  skip(id: string, reason: string): void {
    if (!this.declared.some((t) => t.id === id)) throw new Error(`capture "${id}" is not declared`)
    console.log(`[capture] skipped ${id}: ${reason}`)
    this.skipped.push({ id, reason })
  }

  /** Declared ids, sorted — the expected side of the accounting assertion. */
  declaredIds(): string[] {
    return this.declared.map((t) => t.id).sort()
  }

  /** Captured + skipped ids, sorted. */
  accountedIds(): string[] {
    return [...this.captured.map((r) => r.id), ...this.skipped.map((s) => s.id)].sort()
  }

  /** The contract the Figma follow-up consumes; the gaps are explicit in it. */
  async writeManifest(distributionStates: string[]): Promise<CaptureManifest> {
    const manifest: CaptureManifest = {
      createdAt: new Date().toISOString(),
      platform: process.platform,
      contentSize: { width: CAPTURE_CONTENT_WIDTH, height: CAPTURE_CONTENT_HEIGHT },
      captured: this.captured,
      skipped: this.skipped,
      distributionStates,
    }
    await writeFile(path.join(this.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    return manifest
  }

  /** One `capturePage`, at the display's native scale — no resampling, so Figma
   *  gets @2x on a Retina panel. */
  private shoot(wcId: number, rect: CropRect | null) {
    return this.app.evaluate(async ({ webContents }, payload) => {
      const wc = webContents.fromId(payload.wcId)
      if (!wc || wc.isDestroyed()) throw new Error(`webContents ${payload.wcId} is gone`)
      const image = payload.rect ? await wc.capturePage(payload.rect) : await wc.capturePage()
      return { png: image.toPNG().toString('base64'), empty: image.isEmpty() }
    }, { wcId, rect })
  }

  private async freeze(wcId: number, marker: string): Promise<void> {
    if (this.frozen.has(marker)) return
    await this.app.evaluate(async ({ webContents }, payload) => {
      const wc = webContents.fromId(payload.wcId)
      if (!wc || wc.isDestroyed()) throw new Error(`webContents ${payload.wcId} is gone`)
      await wc.insertCSS(payload.css)
    }, { wcId, css: FREEZE_CSS })
    this.frozen.add(marker)
  }
}
