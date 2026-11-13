import { app } from 'electron'

import { makeOpsFlag, OPS_FLAGS_FILE, readPersistedResult } from '../lib/opsFlag'
import type { FeatureFlagValue } from '../lib/telemetry'

export const APPS_SWITCH_FLAG_KEY = 'desktop_apps_enabled'

export function parseAppsSwitch(value: FeatureFlagValue | undefined): boolean | undefined {
  if (value === true || value === 'on') return true
  if (value === false || value === 'off') return false
  return undefined
}

const fallback = !app.isPackaged
let known: boolean | undefined
const listeners = new Set<(on: boolean) => void>()

function remember(value: FeatureFlagValue | undefined): boolean | undefined {
  const on = parseAppsSwitch(value)
  if (on === undefined) return undefined
  const was = isAppsEnabled()
  known = on
  if (on !== was) for (const listener of listeners) listener(on)
  return on
}

export function onAppsEnabledChanged(listener: (on: boolean) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const flag = makeOpsFlag<boolean>({
  key: APPS_SWITCH_FLAG_KEY,
  fallback,
  parse: remember,
  logLabel: 'apps-switch',
  persist: true
})

function saved(): boolean | undefined {
  try {
    return parseAppsSwitch(readPersistedResult(OPS_FLAGS_FILE, APPS_SWITCH_FLAG_KEY)?.value)
  } catch {
    return undefined
  }
}

export const initAppsSwitch = flag.init

export const getAppsEnabledAsync = flag.get

export function isAppsEnabled(): boolean {
  return known ?? saved() ?? fallback
}

export function _resetForTest(): void {
  flag._resetForTest()
  known = undefined
  listeners.clear()
}
