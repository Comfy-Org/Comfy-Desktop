/**
 * Screenshot a host window the way a user sees it — every WebContentsView composited together.
 *
 * `BrowserWindow.capturePage()` is useless here: the host window has no DOM of its own (title
 * bar, panel, comfyView and every popup are sibling `WebContentsView`s), so it returns a 0x0
 * image. Each view captures fine individually, so this grabs them in z-order and pastes them
 * onto a canvas at their own bounds.
 *
 * The compositing runs inside one of the app's own webContents rather than in the test process,
 * so it needs no image library — Chromium is already there, and the result comes back as a PNG
 * data URL. Nothing is drawn into that page; it only borrows the canvas.
 */
import { writeFile } from 'node:fs/promises'
import type { ElectronApplication } from 'playwright'
import type { WebContentsPage } from './cdpPages'

interface CapturedLayer {
  dataUrl: string
  x: number
  y: number
  width: number
  height: number
}

interface CapturedWindow {
  width: number
  height: number
  layers: CapturedLayer[]
}

/**
 * Capture every visible view of the frontmost visible window.
 *
 * `contentView.children` is back-to-front, which is exactly the paint order, so the array is
 * returned as-is and drawn in sequence. A view that fails to capture is skipped rather than
 * failing the shot: a half-composited screenshot still shows what the test is asserting, and a
 * capture is evidence, not an assertion.
 */
async function captureLayers(app: ElectronApplication): Promise<CapturedWindow> {
  return app.evaluate(async ({ BrowserWindow, WebContentsView }) => {
    // Let any in-flight resize land first. The coachmark popup is shown at a fallback size and
    // resized once the card reports its measured width, so capturing mid-flight pairs a frame
    // from the old size with the new bounds — which draws the card offset from where it really
    // sits, and makes the screenshot lie about anchoring. Evidence has to be trustworthy.
    await new Promise((resolve) => setTimeout(resolve, 400))
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
    if (!win) throw new Error('no visible BrowserWindow to capture')
    const content = win.getContentBounds()
    const layers: CapturedLayer[] = []
    for (const child of win.contentView.children) {
      if (!(child instanceof WebContentsView) || !child.getVisible()) continue
      if (child.webContents.isDestroyed()) continue
      if (child.getBounds().width <= 0 || child.getBounds().height <= 0) continue
      try {
        // Bounded: `capturePage()` waits on the compositor producing a frame, and a view that
        // is visible but not painting (occluded, or mid-navigation) can leave that promise
        // pending indefinitely — which would hang the test rather than the screenshot. A
        // capture is evidence, not an assertion, so a slow view is dropped instead.
        const image = await Promise.race([
          child.webContents.capturePage(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
        ])
        if (!image || image.isEmpty()) continue
        // Bounds re-read AFTER the capture, so the frame and the rectangle it is drawn into
        // describe the same moment. `capturePage` returns device pixels (the image is larger
        // than the bounds at dpr > 1); drawing it into the bounds rescales it.
        layers.push({ dataUrl: image.toDataURL(), ...child.getBounds() })
      } catch {
        // A view that refuses to paint is left out; see the note above.
      }
    }
    return { width: content.width, height: content.height, layers }
  })
}

/**
 * Composite the captured layers and write a PNG.
 *
 * `page` is any of the app's webContents — it supplies the canvas and is otherwise untouched.
 * Returns the file path so a caller can attach it to the Playwright report.
 */
export async function captureHostWindow(
  app: ElectronApplication,
  page: WebContentsPage,
  filePath: string
): Promise<string> {
  const shot = await captureLayers(app)
  if (shot.layers.length === 0) throw new Error('no visible views captured')

  const base64 = await page.evaluate<string>(`(async () => {
    const shot = ${JSON.stringify(shot)}
    const canvas = document.createElement('canvas')
    canvas.width = shot.width
    canvas.height = shot.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    for (const layer of shot.layers) {
      const img = new Image()
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = () => reject(new Error('layer failed to decode'))
        img.src = layer.dataUrl
      })
      // Draw to the view's own bounds: a view captures at its device pixel size, which on a
      // scaled display is larger than the CSS box it occupies.
      ctx.drawImage(img, layer.x, layer.y, layer.width, layer.height)
    }
    return canvas.toDataURL('image/png').split(',')[1]
  })()`)

  await writeFile(filePath, Buffer.from(base64, 'base64'))
  return filePath
}
