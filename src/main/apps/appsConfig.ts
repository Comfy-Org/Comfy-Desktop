import { app } from 'electron'

import { resolveAppsLocation } from '../../shared/appsLocation'
import type { AppsLocation } from '../../shared/appsLocation'

function developerAppsUrl(): string | null {
  if (app.isPackaged) return null
  return process.env['COMFY_APPS_URL']?.trim() || null
}

export function currentAppsLocation(): AppsLocation {
  return resolveAppsLocation(developerAppsUrl())
}
