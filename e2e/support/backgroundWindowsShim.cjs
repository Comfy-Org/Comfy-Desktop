const Module = require('node:module')
const electron = require('electron')

const { app, BrowserWindow: RealBrowserWindow } = electron

RealBrowserWindow.prototype.show = function show() {
  this.showInactive()
}
RealBrowserWindow.prototype.focus = function focus() {}
RealBrowserWindow.prototype.moveTop = function moveTop() {}
RealBrowserWindow.prototype.setAlwaysOnTop = function setAlwaysOnTop() {}
app.focus = () => {}
app.on('web-contents-created', (_event, contents) => {
  contents.focus = () => {}
})

const BackgroundBrowserWindow = class BrowserWindow extends RealBrowserWindow {
  constructor(options = {}) {
    super({ ...options, show: false })
    if (options.show !== false) this.showInactive()
  }
}

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
