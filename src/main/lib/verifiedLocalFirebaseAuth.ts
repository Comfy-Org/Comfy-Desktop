import fs from 'fs'
import path from 'path'
import { isLoopbackHostname } from '../auth/desktopLoginCode/origins'
import { configDir } from './paths'
import { normalizePostHogUserId } from './opaqueIdentifier'
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

function readBindings(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(verifiedLocalFirebaseAuthPath(), 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const bindings: Record<string, string> = {}
    for (const [rawOrigin, rawUserId] of Object.entries(parsed).slice(
      -MAX_VERIFIED_LOCAL_ORIGINS
    )) {
      const origin = normalizeLoopbackOrigin(rawOrigin)
      const userId = normalizePostHogUserId(rawUserId)
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
      // TEMPORARY DIAGNOSTIC — never for merge. This is the branch that destroys its own evidence:
      // an empty map REMOVES the file rather than writing `{}`, so afterwards "never written" and
      // "written then revoked" are the same observation on disk. Three diagnostic chains died here.
      console.log('[identity-diag] bindings file REMOVED (map empty) - the revoke path')
      fs.rmSync(verifiedLocalFirebaseAuthPath(), { force: true })
    } else {
      console.log('[identity-diag] bindings file written origins=' + Object.keys(bindings).length)
      writeFileSafe(verifiedLocalFirebaseAuthPath(), JSON.stringify(bindings))
    }
    return true
  } catch (err) {
    console.log(
      '[identity-diag] bindings write FAILED name=' + (err instanceof Error ? err.name : 'unknown')
    )
    return false
  }
}

export function readVerifiedLocalFirebaseUser(origin: string): string | null {
  const normalizedOrigin = normalizeLoopbackOrigin(origin)
  return normalizedOrigin ? (readBindings()[normalizedOrigin] ?? null) : null
}

export function persistVerifiedLocalFirebaseUser(origin: string, userId: string): boolean {
  const normalizedOrigin = normalizeLoopbackOrigin(origin)
  const normalizedUserId = normalizePostHogUserId(userId)
  if (!normalizedOrigin || !normalizedUserId) {
    // TEMPORARY DIAGNOSTIC — never for merge. Host only, never the uid.
    console.log(
      '[identity-diag] binding persist REJECTED origin=' +
        (normalizedOrigin ? 'ok' : 'bad') +
        ' uid=' +
        (normalizedUserId ? 'ok' : 'bad')
    )
    return false
  }
  console.log('[identity-diag] binding persist origin=' + normalizedOrigin)
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
  // TEMPORARY DIAGNOSTIC — never for merge. `had` is what makes a real revocation distinguishable
  // from a no-op clear, which the file's absence afterwards cannot tell you.
  const had = Object.prototype.hasOwnProperty.call(bindings, normalizedOrigin)
  console.log('[identity-diag] binding CLEAR origin=' + normalizedOrigin + ' had=' + String(had))
  delete bindings[normalizedOrigin]
  return writeBindings(bindings)
}

export function isLoopbackOrigin(origin: string): boolean {
  return normalizeLoopbackOrigin(origin) !== null
}
