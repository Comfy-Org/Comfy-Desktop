import fs from 'fs'
import path from 'path'
import { isLoopbackHostname } from '../auth/desktopLoginCode/origins'
import { configDir } from './paths'
import { isIllegalPostHogDistinctId, normalizeOpaqueIdentifier } from './opaqueIdentifier'
import { writeFileSafe } from './safe-file'

const VERIFIED_LOCAL_FIREBASE_AUTH_FILE = 'verified-local-firebase-auth.json'
const MAX_VERIFIED_LOCAL_ORIGINS = 32

function verifiedLocalFirebaseAuthPath(): string {
  return path.join(configDir(), VERIFIED_LOCAL_FIREBASE_AUTH_FILE)
}

function normalizeLoopbackOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (
      url.origin !== value ||
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !isLoopbackHostname(url.hostname)
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

function normalizeUserId(value: unknown): string | null {
  const normalized = normalizeOpaqueIdentifier(value, 256)
  return normalized && !isIllegalPostHogDistinctId(normalized) ? normalized : null
}

function readBindings(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(verifiedLocalFirebaseAuthPath(), 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const bindings: Record<string, string> = {}
    for (const [rawOrigin, rawUserId] of Object.entries(parsed).slice(
      -MAX_VERIFIED_LOCAL_ORIGINS
    )) {
      const origin = normalizeLoopbackOrigin(rawOrigin)
      const userId = normalizeUserId(rawUserId)
      if (origin && userId) bindings[origin] = userId
    }
    return bindings
  } catch {
    return {}
  }
}

function writeBindings(bindings: Record<string, string>): boolean {
  try {
    if (Object.keys(bindings).length === 0) {
      fs.rmSync(verifiedLocalFirebaseAuthPath(), { force: true })
    } else {
      writeFileSafe(verifiedLocalFirebaseAuthPath(), JSON.stringify(bindings))
    }
    return true
  } catch {
    return false
  }
}

export function readVerifiedLocalFirebaseUser(origin: string): string | null {
  const normalizedOrigin = normalizeLoopbackOrigin(origin)
  return normalizedOrigin ? (readBindings()[normalizedOrigin] ?? null) : null
}

export function persistVerifiedLocalFirebaseUser(origin: string, userId: string): boolean {
  const normalizedOrigin = normalizeLoopbackOrigin(origin)
  const normalizedUserId = normalizeUserId(userId)
  if (!normalizedOrigin || !normalizedUserId) return false
  const entries = Object.entries(readBindings()).filter(
    ([candidate]) => candidate !== normalizedOrigin
  )
  entries.push([normalizedOrigin, normalizedUserId])
  return writeBindings(Object.fromEntries(entries.slice(-MAX_VERIFIED_LOCAL_ORIGINS)))
}

export function clearVerifiedLocalFirebaseUser(origin: string): boolean {
  const normalizedOrigin = normalizeLoopbackOrigin(origin)
  if (!normalizedOrigin) return false
  const bindings = readBindings()
  delete bindings[normalizedOrigin]
  return writeBindings(bindings)
}

export function isLoopbackOrigin(origin: string): boolean {
  return normalizeLoopbackOrigin(origin) !== null
}
