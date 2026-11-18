import { app, shell } from 'electron'
import { recordShellOpenExternal } from './e2eOverrides'

const OPENABLE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:'])

function openableHref(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null
  try {
    const url = new URL(candidate)
    return OPENABLE_PROTOCOLS.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

export function isOpenableExternalUrl(candidate: unknown): candidate is string {
  return openableHref(candidate) !== null
}

export async function openExternalUrl(candidate: string): Promise<void> {
  const href = openableHref(candidate)
  if (href === null) throw new Error('Refused to open a link that is not http, https or mailto.')
  if (process.env['E2E'] === '1' && !app.isPackaged) {
    recordShellOpenExternal(href)
    return
  }
  await shell.openExternal(href)
}

export function tryOpenExternalUrl(candidate: unknown): Promise<boolean> {
  if (typeof candidate !== 'string') return Promise.resolve(false)
  return openExternalUrl(candidate).then(
    () => true,
    () => false
  )
}
