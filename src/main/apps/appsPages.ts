import type { WebContents, WebFrameMain } from 'electron'

import { isInAppsScope } from '../../shared/appsLocation'
import { currentAppsLocation } from './appsConfig'

const hostedPages = new Set<WebContents>()

export function registerAppsPage(contents: WebContents): () => void {
  hostedPages.add(contents)
  return () => {
    hostedPages.delete(contents)
  }
}

export function isAppsPageSender(sender: WebContents, senderFrame: WebFrameMain | null): boolean {
  if (!senderFrame || !hostedPages.has(sender)) return false
  const mainFrame = sender.mainFrame
  if (
    senderFrame.processId !== mainFrame.processId ||
    senderFrame.routingId !== mainFrame.routingId
  )
    return false
  return isInAppsScope(currentAppsLocation(), senderFrame.url)
}

export function liveAppsPages(): WebContents[] {
  const location = currentAppsLocation()
  return [...hostedPages].filter(
    (contents) => !contents.isDestroyed() && isInAppsScope(location, contents.getURL())
  )
}

export function _resetForTest(): void {
  hostedPages.clear()
}
