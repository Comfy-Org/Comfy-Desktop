import type { AppBadge, HiddenAppReason } from '../types/ipc'

interface ReasonWords {
  id: string
  text: string
  description: string
}

const REASON_WORDS: Record<HiddenAppReason, ReasonWords> = {
  off: {
    id: 'hidden-off',
    text: 'staffApps.reason.off',
    description: 'staffApps.reasonDescription.off'
  },
  draft: {
    id: 'hidden-draft',
    text: 'staffApps.reason.draft',
    description: 'staffApps.reasonDescription.draft'
  },
  hub_only: {
    id: 'hidden-hub-only',
    text: 'staffApps.reason.hubOnly',
    description: 'staffApps.reasonDescription.hubOnly'
  },
  unpublished: {
    id: 'hidden-unpublished',
    text: 'staffApps.reason.unpublished',
    description: 'staffApps.reasonDescription.unpublished'
  }
}

export function hiddenAppBadges(
  reasons: readonly HiddenAppReason[],
  t: (key: string) => string
): AppBadge[] {
  return reasons.map((reason): AppBadge => {
    const words = REASON_WORDS[reason]
    return {
      id: words.id,
      style: 'chip',
      text: { en: t(words.text) },
      description: { en: t(words.description) }
    }
  })
}
