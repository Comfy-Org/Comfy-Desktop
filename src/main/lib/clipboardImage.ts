import { clipboard, ClipboardItem } from 'electron'
import type { NativeImage } from 'electron'

const PNG_MIME_TYPE = 'image/png'

export function copyImageToClipboard(image: NativeImage): Promise<void> {
  const png = new Blob([new Uint8Array(image.toPNG())], { type: PNG_MIME_TYPE })
  return clipboard.write([new ClipboardItem({ [PNG_MIME_TYPE]: png })])
}
