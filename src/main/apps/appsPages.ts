import type { WebContents, WebFrameMain } from 'electron'

import { isInAppsScope } from '../../shared/appsLocation'
import { currentAppsLocation } from './appsConfig'

export type AppsPageAdmits = () => Promise<boolean>

const admitsAnyPage: AppsPageAdmits = async () => true
const hostedPages = new Map<WebContents, AppsPageAdmits>()

export function registerAppsPage(
  contents: WebContents,
  admits: AppsPageAdmits = admitsAnyPage
): () => void {
  hostedPages.set(contents, admits)
  return () => {
    hostedPages.delete(contents)
  }
}

export async function appsPageAdmits(contents: WebContents): Promise<boolean> {
  const admits = hostedPages.get(contents)
  if (!admits) return false
  try {
    return (await admits()) && hostedPages.get(contents) === admits
  } catch {
    return false
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
  return [...hostedPages.keys()].filter(
    (contents) => !contents.isDestroyed() && isInAppsScope(location, contents.getURL())
  )
}

export function _resetForTest(): void {
  hostedPages.clear()
}
