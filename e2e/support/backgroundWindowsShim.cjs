/**
 * Test-only Electron preload that stops the app taking OS focus during local e2e runs.
 *
 * Loaded with Electron's `-r` flag by `launchLauncherApp`, only when `focusMode.ts` selects
 * background mode. It never ships: nothing under `src/` references it. See "Local focus
 * behaviour" in `e2e/README.md`.
 */
const Module = require('node:module')
const electron = require('electron')

const { app, BrowserWindow: RealBrowserWindow } = electron

RealBrowserWindow.prototype.show = function show() {
  this.showInactive()
}
RealBrowserWindow.prototype.focus = function focus() {}
RealBrowserWindow.prototype.moveTop = function moveTop() {}
// `bringToFront` raises a window with an always-on-top flip, which needs no focus to cover
// whatever the developer is working in.
RealBrowserWindow.prototype.setAlwaysOnTop = function setAlwaysOnTop() {}
app.focus = () => {}
// Measured on Windows: `webContents.focus()` activates the OS window that hosts the view.
// `sendInputEvent` reaches the page without it.
app.on('web-contents-created', (_event, contents) => {
  contents.focus = () => {}
})

/** A window constructed visible activates inside the native constructor, before any JS can
 *  intervene, so it has to be constructed hidden and then shown inactive. Keeps the name
 *  `BrowserWindow` because `BrowserWindow.getAllWindows()` filters on `constructor.name`. */
const BackgroundBrowserWindow = class BrowserWindow extends RealBrowserWindow {
  constructor(options = {}) {
    super({ ...options, show: false })
    if (options.show !== false) this.showInactive()
  }
}

// `electron`'s exports are non-configurable getters, so the class can only be swapped by
// handing out a proxy to everything that requires the module, including Playwright's evaluate.
const electronProxy = new Proxy(electron, {
  get(target, property, receiver) {
    if (property === 'BrowserWindow') return BackgroundBrowserWindow
    return Reflect.get(target, property, receiver)
  }
})
const originalLoad = Module._load
Module._load = function load(request, ...rest) {
  if (request === 'electron') return electronProxy
  return originalLoad.call(this, request, ...rest)
}
