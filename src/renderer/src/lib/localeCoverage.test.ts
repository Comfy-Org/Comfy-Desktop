import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import en from '@locales/en.json'
import zh from '@locales/zh.json'

type Tree = Record<string, unknown>

const SOURCE_ROOT = path.resolve(__dirname, '../../..')
const STATIC_KEY = String.raw`([A-Za-z_][\w-]*(?:\.[\w-]+)+)`
const KEY_REFERENCES = [
  new RegExp(
    String.raw`(?<![\w.$])(?:\$t|t|tm|i18n\.global\.t)\(\s*(['"\x60])${STATIC_KEY}\1`,
    'g'
  ),
  new RegExp(String.raw`\bkeypath=(["'])${STATIC_KEY}\1`, 'g')
]
const INLINE_DEFAULT_MESSAGE = new RegExp(
  String.raw`(?<![\w.$])(?:\$t|t|i18n\.global\.t)\(\s*(['"\x60])${STATIC_KEY}\1\s*,\s*['"\x60]`,
  'g'
)

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|vue)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [full] : []
  })
}

function hasMessage(tree: Tree, key: string): boolean {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return false
    node = (node as Tree)[part]
  }
  return node !== undefined
}

function sourceMatches(patterns: RegExp[], keep: (key: string) => boolean): string[] {
  const found: string[] = []
  for (const file of sourceFiles(SOURCE_ROOT)) {
    const source = fs.readFileSync(file, 'utf-8')
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const key = match[2]
        if (!keep(key)) continue
        const line = source.slice(0, match.index).split('\n').length
        found.push(`${path.relative(SOURCE_ROOT, file).split(path.sep).join('/')}:${line} ${key}`)
      }
    }
  }
  return found
}

function flatten(obj: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of flatten(value as Tree, path)) out.set(k, v)
    } else if (typeof value === 'string') {
      out.set(path, value)
    }
  }
  return out
}

describe('locale coverage', () => {
  const enKeys = flatten(en as Tree)
  const zhKeys = flatten(zh as Tree)

  it('en defines every key the source code references', () => {
    const missing = sourceMatches(KEY_REFERENCES, (key) => !hasMessage(en as Tree, key))
    expect(
      missing,
      `en.json is missing ${missing.length} referenced keys:\n${missing.join('\n')}`
    ).toEqual([])
  })

  it('source code reads copy from the locales instead of passing it inline', () => {
    const inline = sourceMatches([INLINE_DEFAULT_MESSAGE], () => true)
    expect(
      inline,
      `${inline.length} translation calls pass inline text that duplicates the locales:\n${inline.join('\n')}`
    ).toEqual([])
  })

  it('zh translates every en key', () => {
    const missing = [...enKeys.keys()].filter((k) => k !== '_label' && !zhKeys.has(k))
    expect(missing, `zh.json is missing ${missing.length} keys:\n${missing.join('\n')}`).toEqual([])
  })

  it('zh has no keys absent from en (no orphans)', () => {
    const orphans = [...zhKeys.keys()].filter((k) => k !== '_label' && !enKeys.has(k))
    expect(orphans, `zh.json has orphan keys not in en:\n${orphans.join('\n')}`).toEqual([])
  })

  it('zh preserves every {placeholder} from the en string', () => {
    const placeholders = (s: string): string[] => (s.match(/\{(\w+)\}/g) ?? []).sort()
    const mismatches: string[] = []
    for (const [key, enVal] of enKeys) {
      const zhVal = zhKeys.get(key)
      if (zhVal === undefined) continue
      const a = placeholders(enVal).join(',')
      const b = placeholders(zhVal).join(',')
      if (a !== b) mismatches.push(`${key}: en[${a}] vs zh[${b}]`)
    }
    expect(mismatches, `placeholder mismatch:\n${mismatches.join('\n')}`).toEqual([])
  })
})
