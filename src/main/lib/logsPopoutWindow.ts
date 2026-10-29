/**
 * Pop-out logs window. Standalone BrowserWindow that shows the live
 * stdout/stderr stream of a ComfyUI install. Subscribes to the same
 * per-install broadcast as the inline Logs panel, so it stays in
 * lockstep with the launching window.
 *
 * Unlike the terminal pop-out (full interactive PTY via xterm), this
 * is a read-only auto-scrolling text view. The append-only model lets
 * us avoid xterm entirely — text wraps natively and the browser handles
 * selection/copy.
 *
 * Auto-scroll is sticky: if the user scrolls up to inspect, we stop
 * pinning to the bottom. If they scroll back to within a few pixels of
 * the bottom, sticky-mode re-engages.
 */

import { BrowserWindow } from 'electron'
import path from 'path'
import { COMFY_BG } from './theme'
import { standaloneWindowStyles } from './standaloneStyles'
import * as installations from '../installations'

/**
 * The standalone bootstrap that the pop-out window executes in its
 * renderer. The launcher inserts `__comfyDesktopLogsPopoutInstallationId`
 * before this script runs.
 */
const POPOUT_MAIN_JS = `
(function () {
  'use strict';
  if (window.__comfyDesktopLogsPopoutMounted) return;
  window.__comfyDesktopLogsPopoutMounted = true;
  var INSTALL_ID = window.__comfyDesktopLogsPopoutInstallationId;
  var bridge = window.__comfyDesktop2 && window.__comfyDesktop2.Logs;
  if (!INSTALL_ID || !bridge) return;

  var root = document.body;
  root.classList.remove('h-full', 'bg-[var(--logs-popout-bg)]');
  root.classList.add('box-border', 'h-screen', 'overflow-hidden', 'flex', 'flex-col', 'bg-[#171717]');

  var toolbar = document.createElement('div');
  toolbar.className = 'flex flex-none items-center justify-end gap-2 border-b border-b-[#2a2a2a] bg-[#0f0f0f] px-3 py-1.5 text-[12px] text-[#a3a3a3] [font-family:-apple-system,BlinkMacSystemFont,Segoe_UI,sans-serif]';
  var stickyChip = document.createElement('span');
  stickyChip.textContent = 'Auto-scroll on';
  stickyChip.className = 'opacity-70';
  var clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear';
  clearBtn.className = 'cursor-pointer rounded-md border border-solid border-[#2a2a2a] bg-[#171717] px-2.5 py-0.5 text-[12px] text-[#e5e5e5]';
  toolbar.appendChild(stickyChip);
  toolbar.appendChild(clearBtn);
  root.appendChild(toolbar);

  var view = document.createElement('pre');
  view.className = 'm-0 flex-auto overflow-auto bg-[#171717] px-3 py-2 text-[12px] leading-[1.45] whitespace-pre-wrap text-[#e5e5e5] [word-break:break-word] [font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,Liberation_Mono,Courier_New,monospace]';
  root.appendChild(view);

  var state = { sticky: true, disposed: false };

  function isAtBottom() {
    return view.scrollHeight - view.clientHeight - view.scrollTop < 8;
  }

  function append(text) {
    if (!text) return;
    view.appendChild(document.createTextNode(text));
    if (state.sticky) view.scrollTop = view.scrollHeight;
  }

  view.addEventListener('scroll', function () {
    var atBottom = isAtBottom();
    if (atBottom !== state.sticky) {
      state.sticky = atBottom;
      stickyChip.textContent = state.sticky ? 'Auto-scroll on' : 'Auto-scroll paused';
    }
  });

  clearBtn.addEventListener('click', function () {
    view.textContent = '';
    state.sticky = true;
    stickyChip.textContent = 'Auto-scroll on';
  });

  var offOutput = bridge.onOutput(function (msg) {
    if (state.disposed) return;
    if (!msg || msg.installationId !== INSTALL_ID) return;
    append(msg.text);
  });

  window.addEventListener('beforeunload', function () {
    state.disposed = true;
    try { offOutput && offOutput(); } catch (e) {}
    try { bridge.unsubscribe(INSTALL_ID); } catch (e) {}
  });

  bridge.subscribe(INSTALL_ID).then(function (restore) {
    if (state.disposed || !restore || !restore.buffer) return;
    append(restore.buffer.join(''));
  }).catch(function () {});
})();
`

function buildPopoutScript(installationId: string): string {
  return (
    `window.__comfyDesktopLogsPopoutInstallationId = ${JSON.stringify(installationId)};\n` +
    POPOUT_MAIN_JS
  )
}

// One pop-out per install — second click on the inline Logs button
// focuses the existing window instead of spawning a duplicate.
const popoutsByInstallation = new Map<string, BrowserWindow>()

export async function openLogsPopout(installationId: string): Promise<void> {
  const existing = popoutsByInstallation.get(installationId)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }

  let label = 'Comfy Logs'
  try {
    const inst = await installations.get(installationId)
    if (inst?.name) label = `Comfy Logs — ${inst.name}`
  } catch {
    // installations registry not ready; keep the generic label
  }

  const win = new BrowserWindow({
    width: 880,
    height: 520,
    title: label,
    backgroundColor: COMFY_BG,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/comfyPreload.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  popoutsByInstallation.set(installationId, win)
  win.on('closed', () => {
    const cur = popoutsByInstallation.get(installationId)
    if (cur === win) popoutsByInstallation.delete(installationId)
  })

  const html =
    `<!DOCTYPE html><html class="m-0 h-full bg-[var(--logs-popout-bg)] p-0" style="--logs-popout-bg:${COMFY_BG};"><head><meta charset="utf-8"><title>${label}</title>` +
    `<style>${standaloneWindowStyles}</style>` +
    `</head><body class="m-0 h-full bg-[var(--logs-popout-bg)] p-0"></body></html>`
  void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

  win.webContents.once('did-finish-load', () => {
    void win.webContents.executeJavaScript(buildPopoutScript(installationId)).catch(() => {})
  })
}

/**
 * Close the logs pop-out for a single install, if one is open. Mirrors
 * {@link closeTerminalPopout}: invoked on detach / host-window close so a
 * lingering pop-out can't keep the app alive, and before update/restore.
 */
export function closeLogsPopout(installationId: string): void {
  const win = popoutsByInstallation.get(installationId)
  popoutsByInstallation.delete(installationId)
  if (win && !win.isDestroyed()) win.destroy()
}

/** Close every open logs pop-out (e.g. on app quit). */
export function closeAllLogsPopouts(): void {
  for (const win of popoutsByInstallation.values()) {
    if (!win.isDestroyed()) win.destroy()
  }
  popoutsByInstallation.clear()
}
