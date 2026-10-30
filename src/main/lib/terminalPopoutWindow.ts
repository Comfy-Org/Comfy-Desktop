/**
 * Pop-out terminal window. A small standalone Electron BrowserWindow that
 * runs xterm in a bundled Desktop renderer that is isolated from the served
 * ComfyUI frontend. Uses the same per-install shared shell as the trusted
 * console view (`terminal-*` IPC handlers in `registerTerminalHandlers.ts`).
 *
 * The dedicated preload is the security boundary: this renderer gets PTY
 * access while the served ComfyUI renderer gets only an open/focus request.
 */

import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import path from 'path'
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { COMFY_BG } from './theme'
import { standaloneWindowStyles } from './standaloneStyles'
import * as installations from '../installations'

const require = createRequire(__filename)

let cachedScript: string | null = null

function readPackageFile(id: string): string {
  return readFileSync(require.resolve(id), 'utf8')
}

function stripSourceMapComment(source: string): string {
  return source.replace(/\n?\/\/# sourceMappingURL=.*$/u, '')
}

/**
 * Build the standalone xterm bootstrap script for the pop-out window.
 * Memoised — the UMD payloads are large and never change at runtime.
 */
function buildPopoutScript(): string {
  if (!cachedScript) {
    const xtermJs = stripSourceMapComment(readPackageFile('@xterm/xterm/lib/xterm.js'))
    const fitJs = stripSourceMapComment(readPackageFile('@xterm/addon-fit/lib/addon-fit.js'))
    const css = readPackageFile('@xterm/xterm/css/xterm.css')

    cachedScript =
      `(function () {\n` +
      `'use strict';\n` +
      `if (typeof window === 'undefined' || !window.__comfyDesktopTerminal) return;\n` +
      `if (window.__comfyDesktopTerminalPopoutMounted) return;\n` +
      `window.__comfyDesktopTerminalPopoutMounted = true;\n` +
      `var __xt = { exports: {} };\n` +
      `(function () { var module = __xt; var exports = __xt.exports;\n${xtermJs}\n}).call(window);\n` +
      `var __fit = { exports: {} };\n` +
      `(function () { var module = __fit; var exports = __fit.exports; var self = window;\n${fitJs}\n}).call(window);\n` +
      `var XTerm = __xt.exports && __xt.exports.Terminal;\n` +
      `var FitAddon = __fit.exports && __fit.exports.FitAddon;\n` +
      `if (!XTerm || !FitAddon) return;\n` +
      `(function () {\n` +
      `var s = document.getElementById('__comfyDesktopXtermCssPopout');\n` +
      `if (!s) { s = document.createElement('style'); s.id = '__comfyDesktopXtermCssPopout'; s.textContent = ${JSON.stringify(css)}; (document.head || document.documentElement).appendChild(s); }\n` +
      `})();\n` +
      POPOUT_MAIN_JS +
      `})();\n`
  }
  return cachedScript
}

/**
 * Standalone xterm bootstrap. Subscribes to the shared shell of the
 * popout's bound install, wires data/output/exit, fits to the window,
 * and refits on every resize. Render mounts directly to the body — no
 * bottom-panel tab plumbing.
 */
const POPOUT_MAIN_JS = `
var bridge = window.__comfyDesktopTerminal;
if (!bridge) return;

var root = document.body;
root.className = 'm-0 box-border h-screen overflow-hidden bg-[#171717] p-[6px]';

var host = document.createElement('div');
host.className = 'relative h-full w-full overflow-hidden';
root.appendChild(host);

var banner = document.createElement('div');
banner.className = 'absolute inset-x-0 bottom-0 hidden items-center justify-between gap-[12px] bg-[#262626] px-[12px] py-[8px] text-[13px] text-[#e5e5e5]';
var bannerText = document.createElement('span');
bannerText.textContent = 'This terminal session ended.';
var restartBtn = document.createElement('button');
restartBtn.textContent = 'Restart';
restartBtn.className = 'cursor-pointer rounded-[6px] border-0 border-none border-current bg-[#3b82f6] px-[12px] py-[4px] text-[12px] text-white';
banner.appendChild(bannerText);
banner.appendChild(restartBtn);
root.appendChild(banner);

var term = new XTerm({ convertEol: true, theme: { background: '#171717' } });
var fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(host);

var state = { disposed: false, exited: false, resizeTimer: 0 };

function updateBanner() {
  banner.classList.toggle('hidden', !state.exited);
  banner.classList.toggle('flex', state.exited);
}

function doFit(forceReclaim) {
  if (state.disposed || !host.offsetParent) return;
  var dims = fitAddon.proposeDimensions();
  if (!dims || !dims.cols || !dims.rows) return;
  var changed = dims.cols !== term.cols || dims.rows !== term.rows;
  if (changed) term.resize(dims.cols, dims.rows);
  if (changed || forceReclaim) {
    try { bridge.resize(term.cols, term.rows); } catch (e) {}
  }
}

function applyRestore(restore) {
  if (state.disposed || !restore) return;
  if (restore.buffer && restore.buffer.length) {
    term.resize(restore.size.cols, restore.size.rows);
    term.write(restore.buffer.join(''));
  }
  state.exited = !!restore.exited;
  updateBanner();
  window.requestAnimationFrame(function () { doFit(true); });
}

function doRestart() {
  if (state.disposed) return;
  term.reset();
  state.exited = false; updateBanner();
  bridge.restart().then(applyRestore).catch(function () {});
}
restartBtn.addEventListener('click', doRestart);

term.onData(function (d) { try { bridge.write(d); } catch (e) {} });
var offOutput = bridge.onOutput(function (msg) {
  if (state.disposed) return;
  if (state.exited) { state.exited = false; updateBanner(); }
  term.write(msg);
});
var offExited = bridge.onExited(function () {
  if (state.disposed) return;
  state.exited = true; updateBanner();
});

var ro = new ResizeObserver(function () {
  if (state.resizeTimer) clearTimeout(state.resizeTimer);
  state.resizeTimer = setTimeout(function () { doFit(false); }, 50);
});
ro.observe(root);

window.addEventListener('beforeunload', function () {
  state.disposed = true;
  try { offOutput && offOutput(); } catch (e) {}
  try { offExited && offExited(); } catch (e) {}
  try { ro.disconnect(); } catch (e) {}
  try { bridge.unsubscribe(); } catch (e) {}
  try { term.dispose(); } catch (e) {}
});

bridge.subscribe().then(function (restore) {
  if (state.disposed) return;
  if (restore && restore.exited) doRestart();
  else applyRestore(restore);
  window.requestAnimationFrame(function () { doFit(true); });
}).catch(function () {});
`

// Track open pop-outs per installation so a second click on the inline
// button focuses the existing window instead of spawning a duplicate.
const popoutsByInstallation = new Map<string, BrowserWindow>()

export function findTerminalPopoutInstallationIdBySender(sender: WebContents): string | null {
  for (const [installationId, window] of popoutsByInstallation) {
    if (!window.isDestroyed() && window.webContents === sender) return installationId
  }
  return null
}

export async function openTerminalPopout(installationId: string): Promise<void> {
  const existing = popoutsByInstallation.get(installationId)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }

  // Best-effort label using the install's user-facing name; falls back
  // to a generic title when the lookup fails. Lookup is async so the
  // IPC handler awaits this whole call.
  let label = 'Comfy Terminal'
  try {
    const inst = await installations.get(installationId)
    if (inst?.name) label = `Comfy Terminal — ${inst.name}`
  } catch {
    // installations registry not ready; keep the generic label
  }

  const win = new BrowserWindow({
    width: 800,
    height: 480,
    title: label,
    backgroundColor: COMFY_BG,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/terminalPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  popoutsByInstallation.set(installationId, win)
  win.on('closed', () => {
    const cur = popoutsByInstallation.get(installationId)
    if (cur === win) popoutsByInstallation.delete(installationId)
  })

  const html =
    `<!DOCTYPE html><html class="m-0 h-full bg-[var(--terminal-window-background)] p-0" style="--terminal-window-background:${COMFY_BG}"><head><meta charset="utf-8"><title>Comfy Terminal</title>` +
    `<style>${standaloneWindowStyles}</style>` +
    `</head><body class="m-0 h-full bg-[var(--terminal-window-background)] p-0"></body></html>`
  void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

  win.webContents.once('did-finish-load', () => {
    win.setTitle(label)
    void win.webContents.executeJavaScript(buildPopoutScript()).catch(() => {})
  })
}

/**
 * Close the terminal pop-out for a single install, if one is open. Used when
 * the install is detached / its host window closes (so an orphaned pop-out
 * can't keep the app alive) and before update/restore (so the shared shell
 * can be torn down without a surface still bound to it). The window's
 * `closed` handler drops the map entry; we delete eagerly too so a
 * concurrent re-open spawns a fresh window.
 */
export function closeTerminalPopout(installationId: string): void {
  const win = popoutsByInstallation.get(installationId)
  popoutsByInstallation.delete(installationId)
  if (win && !win.isDestroyed()) win.destroy()
}

/** Close every open terminal pop-out (e.g. on app quit). */
export function closeAllTerminalPopouts(): void {
  for (const win of popoutsByInstallation.values()) {
    if (!win.isDestroyed()) win.destroy()
  }
  popoutsByInstallation.clear()
}
