import path from 'path'
import fs from 'fs'
import * as telemetry from './telemetry'
import { configDir } from './paths'

let enteredThisSession = false

function cloudEnteredGuardPath(): string {
  return path.join(configDir(), 'cloud-entered-completed')
}

function hasEnteredCloudBefore(): boolean {
  try {
    return fs.existsSync(cloudEnteredGuardPath())
  } catch {
    return false
  }
}

function markCloudEntered(): void {
  try {
    fs.mkdirSync(path.dirname(cloudEnteredGuardPath()), { recursive: true })
    fs.writeFileSync(cloudEnteredGuardPath(), new Date().toISOString())
  } catch {}
}

export function noteCloudEntered(): void {
  if (enteredThisSession) return
  enteredThisSession = true
  const firstTime = !hasEnteredCloudBefore()
  if (firstTime) {
    markCloudEntered()
    telemetry.registerPersonProperties({ has_launched_cloud: true })
  }
  telemetry.emit('comfy.desktop.cloud.entered', {
    first_time: firstTime,
    deployment: 'cloud' satisfies telemetry.Deployment
  })
}

export function _resetForTest(): void {
  enteredThisSession = false
}
