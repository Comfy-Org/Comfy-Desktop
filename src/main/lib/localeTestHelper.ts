import fs from 'fs'
import path from 'path'

const enMessages = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../locales/en.json'), 'utf-8')
) as Record<string, unknown>

export function lookupEnMessage(key: string): string {
  let val: unknown = enMessages
  for (const part of key.split('.')) {
    if (val == null || typeof val !== 'object') return key
    val = (val as Record<string, unknown>)[part]
  }
  return typeof val === 'string' ? val : key
}
