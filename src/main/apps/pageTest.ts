import { createHash } from 'crypto'

import type { TelemetryContext } from '../lib/telemetry'

export const CONTROL_VARIANT = 'control'
export const MAX_PAGE_TEST_VARIANTS = 4
const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/
const ALL_INSTALLS = 100

export interface PageTestVariant {
  name: string
  share: number
  pageUrl: string
}

export interface PageTest {
  key: string
  variants: PageTestVariant[]
}

export interface PageTestGroup {
  key: string
  variant: string
  pageUrl: string | null
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function isShare(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= ALL_INSTALLS
}

function isVariantName(name: string): boolean {
  return SLUG.test(name) && name !== CONTROL_VARIANT
}

function byName(a: PageTestVariant, b: PageTestVariant): number {
  if (a.name === b.name) return 0
  return a.name < b.name ? -1 : 1
}

function variantOf(
  name: string,
  value: unknown,
  pageUrlOf: (page: string) => string | null
): PageTestVariant | null {
  const record = asRecord(value)
  const share = record?.share
  const page = record?.page
  if (!isVariantName(name) || !isShare(share) || typeof page !== 'string') return null
  const pageUrl = pageUrlOf(page)
  return pageUrl ? { name, share, pageUrl } : null
}

export function parsePageTest(
  value: unknown,
  pageUrlOf: (page: string) => string | null
): PageTest | null {
  const record = asRecord(value)
  const key = record?.key
  const pages = asRecord(record?.pages)
  if (typeof key !== 'string' || !SLUG.test(key) || !pages) return null
  const entries = Object.entries(pages)
  if (entries.length === 0 || entries.length > MAX_PAGE_TEST_VARIANTS) return null
  const variants: PageTestVariant[] = []
  for (const [name, entry] of entries) {
    const variant = variantOf(name, entry, pageUrlOf)
    if (!variant) return null
    variants.push(variant)
  }
  const total = variants.reduce((sum, variant) => sum + variant.share, 0)
  if (total > ALL_INSTALLS) return null
  return { key, variants: variants.sort(byName) }
}

export function pageTestBucket(key: string, installationId: string): number {
  const hex = createHash('sha256').update(`${key}.${installationId}`).digest('hex')
  return parseInt(hex.slice(0, 8), 16) % ALL_INSTALLS
}

export function variantForBucket(test: PageTest, bucket: number): PageTestVariant | null {
  let total = 0
  for (const variant of test.variants) {
    total += variant.share
    if (total > bucket) return variant
  }
  return null
}

export function pageTestGroup(test: PageTest, installationId: string): PageTestGroup {
  const chosen = variantForBucket(test, pageTestBucket(test.key, installationId))
  return chosen
    ? { key: test.key, variant: chosen.name, pageUrl: chosen.pageUrl }
    : { key: test.key, variant: CONTROL_VARIANT, pageUrl: null }
}

export function pageTestPropertiesOf(group: PageTestGroup | null): TelemetryContext {
  return group ? { page_test_key: group.key, page_test_variant: group.variant } : {}
}

const shownGroups = new Map<string, PageTestGroup>()

export function rememberPageTestGroup(appId: string, group: PageTestGroup | null): void {
  if (group) shownGroups.set(appId, group)
  else shownGroups.delete(appId)
}

export function pageTestPropertiesFor(appId: string | null): TelemetryContext {
  return appId === null ? {} : pageTestPropertiesOf(shownGroups.get(appId) ?? null)
}

export function _resetPageTestsForTest(): void {
  shownGroups.clear()
}
