import fs from 'fs'
import path from 'path'

type TestLocale = 'en' | 'zh'

function readLocale(locale: TestLocale): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, `../../../locales/${locale}.json`), 'utf-8')
  ) as Record<string, unknown>
}

const messagesByLocale: Record<TestLocale, Record<string, unknown>> = {
  en: readLocale('en'),
  zh: readLocale('zh')
}

function lookupMessage(locale: TestLocale, key: string): string {
  let val: unknown = messagesByLocale[locale]
  for (const part of key.split('.')) {
    if (val == null || typeof val !== 'object') return key
    val = (val as Record<string, unknown>)[part]
  }
  return typeof val === 'string' ? val : key
}

export function lookupEnMessage(key: string): string {
  return lookupMessage('en', key)
}

export function translateMessage(
  locale: TestLocale,
  key: string,
  params?: Record<string, string | number>
): string {
  const message = lookupMessage(locale, key)
  if (!params) return message
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    params[name] !== undefined ? String(params[name]) : placeholder
  )
}
