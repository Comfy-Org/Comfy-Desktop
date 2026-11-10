import * as ipc from '../lib/ipc'
import { getAppVersion } from '../lib/ipc'
import { attachSessionDownloadHandler } from '../lib/comfyDownloadManager'
import { getModelDownloadContentScript } from '../lib/comfyContentScript'
import { getComfyTerminalContentScript } from '../lib/comfyTerminalContentScript'
import { closeInstallPopouts } from '../lib/popoutWindows'
import { _operationAborts, sourceMap } from '../lib/ipc/shared'
import { readableSymbolColor } from '../lib/theme'
import * as mainTelemetry from '../lib/telemetry'
import { refreshCloudUserTier } from '../lib/userTier'
import { refreshStaffFlagTargeting } from '../lib/staffFlagTargeting'
import { noteCloudEntered } from '../lib/cloudEntry'
import { noteCanvasRendered } from '../lib/canvasEntry'
import { forwardDatadogError } from '../lib/processErrorHandlers'
import { recordInstanceSurface } from '../lib/lastSession'
import {
  activateFirebaseAuthReporter,
  deactivateFirebaseAuthReporter
} from '../lib/firebaseAuthIdentity'
import { convertLevelToZoomPercent } from '../lib/zoom'
import {
  clearPendingTemplateOpen,
  installationEvents,
  type InstallationRecord
} from '../installations'
import { buildTemplateDeeplink } from '../sources/standalone/curatedTemplates'
import { abortTemplateDownload } from '../sources/standalone/templateDownloadTask'
import { abortModelStaging } from '../sources/comfybuilder/modelStagingTask'
import {
  dropInstallationIndex,
  indexInstallationId,
  isInstallHost,
  setLastFocusedInstallationId
} from './registry'
import type { ComfyWindowEntry } from './registry'

const APP_VERSION = getAppVersion()

const TERMINAL_INJECTION_SOURCE_IDS = new Set(['standalone', 'portable', 'git'])

export type ZoomResetSource = 'titlebar' | 'menu' | 'shortcut'

export interface AttachFactories {
  comfyFailRetryTimerCancels: Map<string, () => void>
  comfyReloads: Map<string, () => void>
  comfyZoomResets: Map<string, (source: ZoomResetSource) => void>
  relaunchStates: Map<string, unknown>
  computeInstallUpdateAvailable: (
    installationId: string
  ) => Promise<{ available: boolean; version?: string }>
}

let factories: AttachFactories | null = null

export function setAttachFactories(opts: AttachFactories): void {
  factories = opts
}

function getFactories(): AttachFactories {
  if (!factories) {
    throw new Error('setAttachFactories must be called before attachInstall')
  }
  return factories
}

export interface AttachInstallOpts {
  installation: InstallationRecord
  comfyUrl: string
  isLocal: boolean
}

export function attachInstall(entry: ComfyWindowEntry, opts: AttachInstallOpts): boolean {
  if (isInstallHost(entry)) {
    const message =
      `attachInstall: entry windowKey=${entry.windowKey} is already attached to ` +
      `installationId=${entry.installationId}; detach first`
    console.error(message)
    forwardDatadogError({
      source: 'attach-install-already-attached',
      message,
      level: 'error',
      context: {
        origin: 'main-process',
        windowKey: String(entry.windowKey),
        existingInstallationId: entry.installationId,
        attemptedInstallationId: opts.installation.id
      }
    })
    return false
  }
  const fx = getFactories()
  const { installation, comfyUrl, isLocal } = opts
  const installationId = installation.id
  const comfyContents = entry.comfyView.webContents
  const comfyWindow = entry.window
  const titleBarView = entry.titleBarView
  activateFirebaseAuthReporter(comfyContents)

  entry.installationId = installationId
  entry.comfyUrl = comfyUrl
  entry.titleBarText = installation.name
  entry.sourceCategory = sourceMap[installation.sourceId]?.category ?? null
  entry.previewInstallationId = null
  indexInstallationId(installationId, entry.windowKey)

  if (comfyWindow.isFocused()) {
    setLastFocusedInstallationId(installationId)
    recordInstanceSurface(installationId)
  }

  let currentInstallName = installation.name

  let currentPageTitle = ''
  const refreshOsWindowTitle = (): void => {
    if (comfyWindow.isDestroyed()) return
    const suffix = currentPageTitle ? ` — ${currentPageTitle}` : ''
    comfyWindow.setTitle(`${currentInstallName}${suffix} — Comfy Desktop v${APP_VERSION}`)
  }
  refreshOsWindowTitle()

  if (!titleBarView.webContents.isDestroyed()) {
    titleBarView.webContents.send('comfy-titlebar:title-changed', entry.titleBarText)
    titleBarView.webContents.send('comfy-titlebar:source-category-changed', entry.sourceCategory)
    titleBarView.webContents.send('comfy-titlebar:installation-id-changed', installationId)
    titleBarView.webContents.send('comfy-titlebar:preview-mode-changed', false)
    void fx.computeInstallUpdateAvailable(installationId).then((state) => {
      if (titleBarView.webContents.isDestroyed()) return
      titleBarView.webContents.send('comfy-titlebar:install-update-changed', state)
    })
  }

  const onInstallationUpdated = (updated: InstallationRecord): void => {
    if (updated.id !== entry.installationId) return
    const nextTabText = updated.name
    if (nextTabText !== entry.titleBarText) {
      entry.titleBarText = nextTabText
      if (!titleBarView.webContents.isDestroyed()) {
        titleBarView.webContents.send('comfy-titlebar:title-changed', nextTabText)
      }
    }
    const nextCategory = sourceMap[updated.sourceId]?.category ?? null
    if (nextCategory !== entry.sourceCategory) {
      entry.sourceCategory = nextCategory
      if (!titleBarView.webContents.isDestroyed()) {
        titleBarView.webContents.send('comfy-titlebar:source-category-changed', nextCategory)
      }
    }
    if (updated.name !== currentInstallName) {
      currentInstallName = updated.name
      refreshOsWindowTitle()
    }
    void fx.computeInstallUpdateAvailable(updated.id).then((state) => {
      if (titleBarView.webContents.isDestroyed()) return
      titleBarView.webContents.send('comfy-titlebar:install-update-changed', state)
    })
  }
  installationEvents.on('updated', onInstallationUpdated)

  const applyComfyTheme = (bg: string): void => {
    if (comfyWindow.isDestroyed()) return
    const theme = { bg, text: readableSymbolColor(bg) }
    entry.lastTheme = theme
    if (!titleBarView.webContents.isDestroyed()) {
      titleBarView.webContents.send('comfy-titlebar:theme-changed', theme)
    }
    if (process.platform !== 'darwin') {
      try {
        comfyWindow.setTitleBarOverlay({ color: theme.bg, symbolColor: theme.text })
      } catch {}
    }
  }
  const onIpcMessage = (
    _event: Electron.IpcMainEvent,
    channel: string,
    ...args: unknown[]
  ): void => {
    if (channel === 'desktop2-theme-report') {
      const { bg } = (args[0] || {}) as { bg?: string; text?: string }
      if (bg) applyComfyTheme(bg)
    }
  }
  comfyContents.on('ipc-message', onIpcMessage)

  const onPageTitleUpdated = (e: Electron.Event, title: string): void => {
    e.preventDefault()
    currentPageTitle = title
    refreshOsWindowTitle()
  }
  comfyContents.on('page-title-updated', onPageTitleUpdated)

  const COMFY_THEME_OBSERVER_JS =
    `(function(){` +
    `let last='';` +
    `function read(){` +
    `const s=getComputedStyle(document.body);` +
    `const bg=s.getPropertyValue('--comfy-menu-bg').trim();` +
    `const text=s.getPropertyValue('--descrip-text').trim();` +
    `const key=bg+'|'+text;` +
    `if(key!==last&&bg){last=key;window.__comfyDesktop2?.reportTheme?.(bg,text)}` +
    `}` +
    `new MutationObserver(()=>setTimeout(read,50)).observe(document.documentElement,{attributes:true,attributeFilter:['class','data-theme','style']});` +
    `read();` +
    `})()`

  const COMFY_CLOUD_PATCHES_JS =
    `(function(){` +
    `try{` +
    `if(sessionStorage.getItem('__comfyDesktopPostSignin')==='1'){` +
    `sessionStorage.removeItem('__comfyDesktopPostSignin');` +
    `var de=document.documentElement;` +
    `de.style.visibility='hidden';` +
    `setTimeout(function(){de.style.visibility=''},1000);` +
    `}` +
    `}catch(_){}` +
    `try{` +
    `if(!document.getElementById('__comfyDesktopHideDownloadCta')){` +
    `var st=document.createElement('style');` +
    `st.id='__comfyDesktopHideDownloadCta';` +
    `st.textContent='[data-comfy-desktop-hide="download-cta"]{display:none !important}';` +
    `(document.head||document.documentElement).appendChild(st);` +
    `}` +
    `}catch(_){}` +
    `function looksBlocked(n){` +
    `if(!n||n.nodeType!==1)return false;` +
    `var t=(n.textContent||'').toLowerCase();` +
    `return t.indexOf('auth/popup-blocked')>=0` +
    `||t.indexOf('signing you in')>=0;` +
    `}` +
    `function nukeToast(n){` +
    `var root=(n.closest&&n.closest('.p-toast-message,.p-toast-item,[role=alert]'))||n;` +
    `try{root.remove()}catch(_){}` +
    `}` +
    `function tagDownloadCta(){` +
    `var els=document.querySelectorAll('button,a,[role="button"]');` +
    `for(var i=0;i<els.length;i++){` +
    `var el=els[i];` +
    `if(!el)continue;` +
    `var t=(el.textContent||'').trim().toLowerCase();` +
    `if(t!=='download comfyui')continue;` +
    `el.setAttribute('data-comfy-desktop-hide','download-cta');` +
    `var cur=el.parentElement,tagged=false;` +
    `while(cur&&cur!==document.body){` +
    `var ct=(cur.textContent||'').toLowerCase();` +
    `if(ct.indexOf('want to run')>=0&&ct.indexOf('comfyui')>=0){` +
    `cur.setAttribute('data-comfy-desktop-hide','download-cta');` +
    `tagged=true;break;` +
    `}` +
    `cur=cur.parentElement;` +
    `}` +
    `if(!tagged&&el.parentElement&&el.parentElement.setAttribute){` +
    `el.parentElement.setAttribute('data-comfy-desktop-hide','download-cta');` +
    `}` +
    `}` +
    `}` +
    `tagDownloadCta();` +
    `try{` +
    `new MutationObserver(function(muts){` +
    `for(var i=0;i<muts.length;i++){` +
    `var added=muts[i].addedNodes;` +
    `for(var j=0;j<added.length;j++){` +
    `var n=added[j];` +
    `if(looksBlocked(n)){nukeToast(n);continue;}` +
    `if(n.querySelectorAll){` +
    `var hits=n.querySelectorAll('*');` +
    `for(var k=0;k<hits.length;k++){` +
    `if(looksBlocked(hits[k])){nukeToast(hits[k]);break;}` +
    `}` +
    `}` +
    `}` +
    `}` +
    `tagDownloadCta();` +
    `}).observe(document.documentElement,{childList:true,subtree:true});` +
    `}catch(_){}` +
    `try{` +
    `var __ctaPolls=0;` +
    `var __ctaPoll=setInterval(function(){` +
    `tagDownloadCta();` +
    `__ctaPolls++;if(__ctaPolls>60)clearInterval(__ctaPoll);` +
    `},500);` +
    `}catch(_){}` +
    `})()`

  const onDomReady = (): void => {
    comfyContents.executeJavaScript(COMFY_THEME_OBSERVER_JS).catch(() => {})
    comfyContents.executeJavaScript(getModelDownloadContentScript()).catch(() => {})
    if (isLocal && TERMINAL_INJECTION_SOURCE_IDS.has(installation.sourceId)) {
      comfyContents.executeJavaScript(getComfyTerminalContentScript()).catch(() => {})
    }
    void refreshStaffFlagTargeting(comfyContents)

    if (!isLocal) {
      comfyContents.executeJavaScript(COMFY_CLOUD_PATCHES_JS).catch(() => {})
      void refreshCloudUserTier(comfyContents)
      noteCloudEntered()
    } else {
      noteCanvasRendered(installationId)
    }
  }
  comfyContents.on('dom-ready', onDomReady)

  const currentComfyUrl = (): string => entry.comfyUrl || comfyUrl
  const reloadComfy = (): void => {
    if (comfyWindow.isDestroyed()) return
    const id = entry.installationId
    if (id === null) return
    if (fx.relaunchStates.has(id)) return
    comfyContents.stop()
    comfyContents.loadURL(currentComfyUrl())
  }
  const onBeforeInputEvent = (e: Electron.Event, input: Electron.Input): void => {
    if (input.type !== 'keyDown') return
    const mod = input.control || input.meta
    if (mod && input.key.toLowerCase() === 'w') {
      e.preventDefault()
      return
    }
    if (input.key === 'F5' || (input.key.toLowerCase() === 'r' && mod)) {
      e.preventDefault()
      reloadComfy()
      return
    }
    if (
      mod &&
      !input.alt &&
      (input.key === '=' || input.key === '+' || input.key === '-' || input.key === '0')
    ) {
      e.preventDefault()
      if (comfyContents.isDestroyed()) return
      if (input.key === '0') {
        const previousLevel = comfyContents.getZoomLevel()
        comfyContents.setZoomLevel(0)
        pushZoom()
        if (previousLevel !== 0) {
          emitZoomReset('shortcut', previousLevel)
        }
        return
      }
      const step = input.key === '-' ? -0.5 : 0.5
      comfyContents.setZoomLevel(comfyContents.getZoomLevel() + step)
      pushZoom()
    }
  }
  comfyContents.on('before-input-event', onBeforeInputEvent)

  const pushZoom = (): void => {
    if (titleBarView.webContents.isDestroyed() || comfyContents.isDestroyed()) return
    titleBarView.webContents.send('comfy-titlebar:zoom-changed', comfyContents.getZoomLevel())
  }
  const onZoomChanged = (): void => pushZoom()
  comfyContents.on('zoom-changed', onZoomChanged)

  const emitZoomReset = (source: ZoomResetSource, previousLevel: number): void => {
    mainTelemetry.emit('comfy.desktop.zoom.reset', {
      source,
      parent_entry_id: entry.windowKey,
      installation_id: entry.installationId,
      previous_zoom_level: previousLevel,
      previous_zoom_percent: convertLevelToZoomPercent(previousLevel)
    })
  }

  let failRetryTimer: ReturnType<typeof setTimeout> | null = null
  const cancelFailRetry = (): void => {
    if (failRetryTimer) {
      clearTimeout(failRetryTimer)
      failRetryTimer = null
    }
  }
  fx.comfyFailRetryTimerCancels.set(installationId, cancelFailRetry)
  fx.comfyReloads.set(installationId, reloadComfy)
  fx.comfyZoomResets.set(installationId, (source) => {
    if (comfyContents.isDestroyed()) return
    const previousLevel = comfyContents.getZoomLevel()
    if (previousLevel === 0) return
    comfyContents.setZoomLevel(0)
    pushZoom()
    emitZoomReset(source, previousLevel)
  })
  const onDidFailLoad = (
    _e: Electron.Event,
    code: number,
    _desc: string,
    _failUrl: string,
    isMainFrame: boolean
  ): void => {
    if (!isMainFrame || code === -3 || failRetryTimer) return
    const id = entry.installationId
    if (id === null) return
    if (isLocal) {
      noteCanvasRendered(id, { loadFailed: true })
    }
    if (fx.relaunchStates.has(id)) return
    failRetryTimer = setTimeout(() => {
      failRetryTimer = null
      const currentId = entry.installationId
      if (currentId === null) return
      if (fx.relaunchStates.has(currentId)) return
      if (!comfyWindow.isDestroyed()) {
        comfyContents.loadURL(currentComfyUrl())
      }
    }, 2000)
  }
  comfyContents.on('did-fail-load', onDidFailLoad)

  const onRenderProcessGone = (
    _event: Electron.Event,
    details: Electron.RenderProcessGoneDetails
  ): void => {
    forwardDatadogError({
      source: 'comfy-window-render-process-gone',
      message: `Comfy window renderer process exited (${details.reason})`,
      level: 'error',
      context: {
        origin: 'main-process',
        installationId: entry.installationId ?? '(detached)',
        reason: details.reason,
        exitCode: details.exitCode
      }
    })
    reloadComfy()
  }
  comfyContents.on('render-process-gone', onRenderProcessGone)

  attachSessionDownloadHandler(comfyContents.session)

  let urlToLoad = comfyUrl
  const pendingTemplate =
    typeof installation.pendingTemplateOpen === 'string' ? installation.pendingTemplateOpen : null
  if (isLocal && pendingTemplate) {
    urlToLoad = buildTemplateDeeplink(comfyUrl, pendingTemplate)
    void clearPendingTemplateOpen(installationId).catch((err) => {
      console.warn(`[templates] Failed to clear pendingTemplateOpen for ${installationId}:`, err)
    })
  }

  comfyContents.loadURL(urlToLoad)

  entry._installCleanup = (): void => {
    if (entry._installCleanup === null) return
    entry._installCleanup = null
    deactivateFirebaseAuthReporter(comfyContents)
    installationEvents.off('updated', onInstallationUpdated)
    cancelFailRetry()
    if (!comfyContents.isDestroyed()) {
      comfyContents.off('ipc-message', onIpcMessage)
      comfyContents.off('page-title-updated', onPageTitleUpdated)
      comfyContents.off('dom-ready', onDomReady)
      comfyContents.off('did-fail-load', onDidFailLoad)
      comfyContents.off('render-process-gone', onRenderProcessGone)
      comfyContents.off('before-input-event', onBeforeInputEvent)
      comfyContents.off('zoom-changed', onZoomChanged)
    }
    const id = entry.installationId
    if (id !== null) {
      const inFlight = _operationAborts.get(id)
      if (inFlight) {
        inFlight.abort()
        _operationAborts.delete(id)
      }
      abortTemplateDownload(id)
      abortModelStaging(id)
      const relaunch = fx.relaunchStates.get(id) as
        | { navBlocker: (...args: unknown[]) => void }
        | undefined
      if (relaunch && !comfyContents.isDestroyed()) {
        comfyContents.off('will-navigate', relaunch.navBlocker)
      }
      ipc.stopRunning(id)
      closeInstallPopouts(id)
      fx.comfyFailRetryTimerCancels.delete(id)
      fx.comfyReloads.delete(id)
      fx.comfyZoomResets.delete(id)
      fx.relaunchStates.delete(id)
      dropInstallationIndex(id)
      entry.installationId = null
    }
    entry.comfyUrl = ''
  }
  return true
}
