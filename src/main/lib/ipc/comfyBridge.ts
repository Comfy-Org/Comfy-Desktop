import { ipcMain } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'

import {
  anyOf,
  installPage,
  logsWindow,
  panelOrTitleBar,
  sessionPage,
  trustedCloudPage
} from './bridgeCallers'
import type { CallerRule } from './bridgeCallers'

const installPageOrDesktop = anyOf(installPage, panelOrTitleBar)
const installPageOrLogsWindow = anyOf(installPage, logsWindow)

export const COMFY_BRIDGE_CALLERS = {
  'desktop2-is-remote': installPage,
  'desktop2-get-install-id': trustedCloudPage,
  'desktop2-theme-report': installPage,
  'desktop2-open-model-access-page': installPage,
  'desktop2-download-model': installPage,
  'desktop2-download-asset': installPage,
  'desktop2-get-template-input-assets': installPage,
  'desktop2-download-template-input-asset': installPage,
  'desktop2-open-terminal': installPage,
  'desktop2-open-terminal-popout': installPage,
  'model-download-pause': installPageOrDesktop,
  'model-download-resume': installPageOrDesktop,
  'model-download-cancel': installPageOrDesktop,
  'logs-subscribe': installPageOrLogsWindow,
  'logs-unsubscribe': installPageOrLogsWindow,
  'logs-popout-open': installPage,
  'logs-snapshot': panelOrTitleBar,
  'telemetry:capture': installPageOrDesktop,
  'telemetry:captureException': installPageOrDesktop,
  'telemetry:firebaseAuthState': installPage,
  'desktop2-auth:get-state': sessionPage,
  'desktop2-auth:get-workspace-token': sessionPage,
  'desktop2-auth:get-partner-node-token': sessionPage,
  'desktop2-auth:request-sign-in': sessionPage,
  'desktop2-auth:sign-out': sessionPage,
  'desktop2-auth:switch-workspace': sessionPage,
  'desktop2-auth:issue-billing-handoff': sessionPage
} as const satisfies Record<string, CallerRule>

export type ComfyBridgeChannel = keyof typeof COMFY_BRIDGE_CALLERS

export function handleBridge<Args extends unknown[], Result>(
  channel: ComfyBridgeChannel,
  refusal: NoInfer<Result>,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>
): void {
  const mayCall = COMFY_BRIDGE_CALLERS[channel]
  ipcMain.handle(channel, (event, ...args) =>
    mayCall(event) ? handler(event, ...(args as Args)) : refusal
  )
}

export function onBridge<Args extends unknown[]>(
  channel: ComfyBridgeChannel,
  handler: (event: IpcMainEvent, ...args: Args) => void
): void {
  const mayCall = COMFY_BRIDGE_CALLERS[channel]
  ipcMain.on(channel, (event, ...args) => {
    if (mayCall(event)) handler(event, ...(args as Args))
  })
}

export function answerBridge<Result>(
  channel: ComfyBridgeChannel,
  refusal: NoInfer<Result>,
  handler: (event: IpcMainEvent) => Result
): void {
  const mayCall = COMFY_BRIDGE_CALLERS[channel]
  ipcMain.on(channel, (event) => {
    let answer = refusal
    try {
      if (mayCall(event)) answer = handler(event)
    } finally {
      event.returnValue = answer
    }
  })
}
