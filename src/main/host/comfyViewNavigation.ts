import type { WebContents } from 'electron'

import { isLikelyDownloadUrl } from '../lib/allowedPopups'
import { tryOpenExternalUrl } from '../lib/openExternal'
import { showsInstallSite } from './installSite'
import type { ComfyWindowEntry } from './registry'

type HostEntryLookup = () => ComfyWindowEntry | undefined

export function comfyViewShowsItsInstall(
  contents: WebContents,
  hostEntry: HostEntryLookup
): boolean {
  const entry = hostEntry()
  return !!entry && showsInstallSite(entry, contents.getURL())
}

export function openOutsideComfyView(contents: WebContents, url: string): void {
  if (isLikelyDownloadUrl(url)) {
    contents.session.downloadURL(url)
    return
  }
  void tryOpenExternalUrl(url)
}

export function keepComfyViewOnInstallSite(
  contents: WebContents,
  hostEntry: HostEntryLookup
): void {
  contents.on('will-navigate', (event, url) => {
    const entry = hostEntry()
    if (!entry || !showsInstallSite(entry, contents.getURL())) return
    if (showsInstallSite(entry, url)) return
    event.preventDefault()
    openOutsideComfyView(contents, url)
  })
}
