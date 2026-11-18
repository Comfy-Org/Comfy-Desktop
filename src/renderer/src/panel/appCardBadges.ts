import type { AppBadge, AppBadgeWords } from '../types/ipc'

export function badgeWords(words: AppBadgeWords, locale: string): string {
  return locale.startsWith('zh') ? (words['zh-CN'] ?? words.en) : words.en
}

export function badgeDescriptionId(prefix: string, badge: AppBadge): string {
  return `${prefix}:${badge.id}`
}

export function badgeDescriptionIds(
  prefix: string,
  badges: readonly AppBadge[] | undefined
): string | undefined {
  if (!badges?.length) return undefined
  return badges.map((badge) => badgeDescriptionId(prefix, badge)).join(' ')
}
