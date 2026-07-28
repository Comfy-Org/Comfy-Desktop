/**
 * Test-only helper: resolves dotted i18n keys against the REAL English
 * catalog (`locales/en.json`) so label assertions catch missing locale keys.
 * Tests mock their i18n module's `t` with `lookupEnMessage` because the real
 * i18n resolves locales relative to the build output, not src.
 */
import fs from 'fs'
import path from 'path'

const enMessages = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../locales/en.json'), 'utf-8')
) as Record<string, unknown>

/** Dotted-key lookup into the en catalog; returns the key itself when
 *  unresolved (mirrors i18n's fallback, and keeps missing-key assertions
 *  readable - the raw key shows up in the failure message). */
export function lookupEnMessage(key: string): string {
  let val: unknown = enMessages
  for (const part of key.split('.')) {
    if (val == null || typeof val !== 'object') return key
    val = (val as Record<string, unknown>)[part]
  }
  return typeof val === 'string' ? val : key
}
