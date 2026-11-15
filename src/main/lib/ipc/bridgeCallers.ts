import type { WebContents, WebFrameMain } from 'electron'

import { isAppsPageSender } from '../../apps/appsPages'
import { showsInstallSite } from '../../host/installSite'
import {
  findEntryByComfySender,
  findEntryByTitleBarSender,
  isPanelSender
} from '../../host/registry'
import type { ComfyWindowEntry } from '../../host/registry'
import { isTrustedSender } from '../embeddedSession'
import { findLogsPopoutInstallationIdBySender } from '../logsPopoutWindow'
import { isTrustedCloudUrl } from '../trustedCloudUrl'

export interface BridgeCaller {
  sender: WebContents
  senderFrame: WebFrameMain | null
}

export type CallerRule = (caller: BridgeCaller) => boolean

export type InstallShownToCaller = ComfyWindowEntry & { installationId: string }

const DESKTOP_WINDOW_PAGE_PREFIX = 'data:'

function mainFrameUrlOf({ sender, senderFrame }: BridgeCaller): string | null {
  if (!senderFrame) return null
  const mainFrame = sender.mainFrame
  const sentByMainFrame =
    senderFrame.processId === mainFrame.processId && senderFrame.routingId === mainFrame.routingId
  return sentByMainFrame ? senderFrame.url : null
}

export function installShownTo(caller: BridgeCaller): InstallShownToCaller | null {
  const entry = findEntryByComfySender(caller.sender)
  const url = mainFrameUrlOf(caller)
  if (!entry || url === null || !showsInstallSite(entry, url)) return null
  return entry as InstallShownToCaller
}

export function installOfLogsWindow(caller: BridgeCaller): string | null {
  const url = mainFrameUrlOf(caller)
  if (url === null || !url.startsWith(DESKTOP_WINDOW_PAGE_PREFIX)) return null
  return findLogsPopoutInstallationIdBySender(caller.sender)
}

export function installPage(caller: BridgeCaller): boolean {
  return installShownTo(caller) !== null
}

export function trustedCloudPage(caller: BridgeCaller): boolean {
  const url = mainFrameUrlOf(caller)
  return (
    url !== null &&
    findEntryByComfySender(caller.sender)?.sourceCategory === 'cloud' &&
    isTrustedCloudUrl(url)
  )
}

export function sessionPage(caller: BridgeCaller): boolean {
  return isTrustedSender(caller) || isAppsPageSender(caller.sender, caller.senderFrame)
}

export function logsWindow(caller: BridgeCaller): boolean {
  return installOfLogsWindow(caller) !== null
}

export function panelOrTitleBar({ sender }: BridgeCaller): boolean {
  return isPanelSender(sender) || findEntryByTitleBarSender(sender) !== null
}

export function anyOf(...rules: CallerRule[]): CallerRule {
  return (caller) => rules.some((rule) => rule(caller))
}
