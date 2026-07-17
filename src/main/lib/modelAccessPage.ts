import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { findEntryByComfySender } from '../host/registry'

const HUGGING_FACE_HOST = 'huggingface.co'

export function isModelAccessPageUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false

  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase() === HUGGING_FACE_HOST &&
      parsed.port === ''
    )
  } catch {
    return false
  }
}

export function openModelAccessPageWindow(sender: WebContents, url: unknown): boolean {
  if (!isModelAccessPageUrl(url)) return false

  const parent = findEntryByComfySender(sender)?.window
  if (!parent || parent.isDestroyed()) return false

  const accessWindow = new BrowserWindow({
    parent,
    width: 1100,
    height: 800,
    minWidth: 720,
    minHeight: 560,
    title: 'Hugging Face',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      // Keep provider login and access grants available to subsequent downloads.
      session: sender.session,
      preload: undefined,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  accessWindow.once('ready-to-show', () => {
    if (!accessWindow.isDestroyed()) accessWindow.show()
  })
  void accessWindow.loadURL(url).catch(() => {
    if (!accessWindow.isDestroyed()) accessWindow.close()
  })

  return true
}
