import type { WebContents } from 'electron'

import { showsInstallSite } from './installSite'
import { findEntryByComfySender } from './registry'

export function sendBridgeEvent(contents: WebContents, channel: string, payload: unknown): void {
  if (contents.isDestroyed()) return
  const comfyHost = findEntryByComfySender(contents)
  if (comfyHost && !showsInstallSite(comfyHost, contents.getURL())) return
  contents.send(channel, payload)
}
