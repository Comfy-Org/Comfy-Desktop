import { app } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'

export const GIVE_UP_WAITING_FOR_WEB_CONTENTS_MS = 2_000

const windowByWebContents = new Map<WebContents, BrowserWindow>()
let quitPostponed = false
let gaveUpWaiting = false
let giveUpTimer: NodeJS.Timeout | null = null

export function trackWindowWebContents(window: BrowserWindow): void {
  const contents = window.webContents
  windowByWebContents.set(contents, window)
  contents.once('destroyed', () => {
    windowByWebContents.delete(contents)
    setImmediate(resumeQuitIfNothingIsLeft)
  })
}

export function postponeQuitWhileDestroyedWindowsHaveLiveWebContents(
  event: Pick<Electron.Event, 'preventDefault'>
): boolean {
  if (gaveUpWaiting || !destroyedWindowHasLiveWebContents()) return false
  event.preventDefault()
  if (!quitPostponed) {
    quitPostponed = true
    giveUpTimer = setTimeout(() => {
      gaveUpWaiting = true
      resumeQuit()
    }, GIVE_UP_WAITING_FOR_WEB_CONTENTS_MS)
  }
  return true
}

function destroyedWindowHasLiveWebContents(): boolean {
  for (const [contents, window] of windowByWebContents) {
    if (window.isDestroyed() && !contents.isDestroyed()) return true
  }
  return false
}

function resumeQuitIfNothingIsLeft(): void {
  if (!quitPostponed || destroyedWindowHasLiveWebContents()) return
  resumeQuit()
}

function resumeQuit(): void {
  quitPostponed = false
  if (giveUpTimer) clearTimeout(giveUpTimer)
  giveUpTimer = null
  app.quit()
}
