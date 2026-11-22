import { app } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const LINK_WAIT_MS = 500
const launcherDir = path.dirname(fileURLToPath(import.meta.url))
const bundleDir = path.resolve(launcherDir, '..', '..', '..')
const launchFile = path.join(path.dirname(bundleDir), 'launch.json')

function startedWithEntry(argv) {
  return argv.slice(1).some((arg) => !arg.startsWith('-'))
}

function startDevServer(launch, link) {
  const log = fs.openSync(launch.log, 'w')
  const [command, ...args] = launch.command
  spawn(command, link ? [...args, link] : args, {
    cwd: launch.cwd,
    env: { ...process.env, ...launch.env },
    detached: true,
    stdio: ['ignore', log, log]
  }).unref()
}

function coldStart() {
  const launch = JSON.parse(fs.readFileSync(launchFile, 'utf-8'))
  app.setPath('userData', launch.userData)
  let firstLink = null
  app.on('open-url', (event, url) => {
    event.preventDefault()
    firstLink ??= url
  })
  app.whenReady().then(() => {
    setTimeout(() => {
      try {
        startDevServer(launch, firstLink)
      } finally {
        app.quit()
      }
    }, LINK_WAIT_MS)
  })
}

if (startedWithEntry(process.argv)) {
  const defaultApp = path.join(process.resourcesPath, 'default_app.asar', 'main.js')
  await import(pathToFileURL(defaultApp).href)
} else {
  coldStart()
}
