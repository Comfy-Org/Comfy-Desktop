const { app } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const LINK_WAIT_MS = 500
const bundleDir = path.resolve(__dirname, '..', '..', '..')
const launchFile = path.join(path.dirname(bundleDir), 'launch.json')

function startedWithEntry(argv) {
  return argv.slice(1).some((arg) => !arg.startsWith('-'))
}

function runDefaultApp() {
  const defaultApp = path.join(process.resourcesPath, 'default_app.asar', 'main.js')
  return import(pathToFileURL(defaultApp).href)
}

function startDevServer(launch, links) {
  const log = fs.openSync(launch.log, 'w')
  const [command, ...args] = launch.command
  spawn(command, [...args, ...links], {
    cwd: launch.cwd,
    env: { ...process.env, ...launch.env },
    detached: true,
    stdio: ['ignore', log, log]
  }).unref()
}

function coldStart() {
  const launch = JSON.parse(fs.readFileSync(launchFile, 'utf-8'))
  app.setPath('userData', launch.userData)
  const links = []
  app.on('open-url', (event, url) => {
    event.preventDefault()
    links.push(url)
  })
  app.whenReady().then(() => {
    setTimeout(() => {
      try {
        startDevServer(launch, links)
      } finally {
        app.quit()
      }
    }, LINK_WAIT_MS)
  })
}

if (startedWithEntry(process.argv)) {
  void runDefaultApp()
} else {
  coldStart()
}
