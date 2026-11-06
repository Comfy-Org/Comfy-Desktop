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

async function captureLayers(app: ElectronApplication): Promise<CapturedWindow> {
  return app.evaluate(async ({ BrowserWindow, WebContentsView }) => {
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
        const image = await Promise.race([
          child.webContents.capturePage(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
        ])
        if (!image || image.isEmpty()) continue
        layers.push({ dataUrl: image.toDataURL(), ...child.getBounds() })
      } catch {}
    }
    return { width: content.width, height: content.height, layers }
  })
}

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
