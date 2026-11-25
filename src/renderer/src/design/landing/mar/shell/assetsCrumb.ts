import { appsProto } from '../../appFlow'
import type { TitleBarCommand, TitleBarState } from '../../titleBarBridge'
import { assetsTab } from '../graph/comfyLook'

/**
 * ComfyUI's Assets tab in the title bar (Glass), kept here so Pablo's
 * titleBar.ts only carries two hooks: its state, after the build like an
 * app, and the commands it answers.
 */
export function assetsCrumbState(build: boolean): Pick<TitleBarState, 'assets'> {
  return assetsTab.open && build ? { assets: { front: assetsTab.on && !appsProto.front } } : {}
}

/** True when the command was the Assets tab's own, and is done. */
export function runAssetsCrumb(cmd: TitleBarCommand): boolean {
  switch (cmd.type) {
    case 'assets':
      appsProto.front = ''
      assetsTab.on = true
      return true
    case 'closeAssets':
      Object.assign(assetsTab, { open: false, on: false })
      return true
    case 'info':
      // With Assets in front, the build's name brings its workflow back.
      if (cmd.phase === 'click' && assetsTab.on) {
        assetsTab.on = false
        return true
      }
      return false
    default:
      return false
  }
}
