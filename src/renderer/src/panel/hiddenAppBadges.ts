import type { AppBadge, HiddenAppReason } from '../types/ipc'

interface ReasonWords {
  id: string
  text: string
  description: string
}

const REASON_WORDS: Record<HiddenAppReason, ReasonWords> = {
  off: {
    id: 'hidden-off',
    text: 'apps.hidden.reason.off',
    description: 'apps.hidden.reasonDescription.off'
  },
  draft: {
    id: 'hidden-draft',
    text: 'apps.hidden.reason.draft',
    description: 'apps.hidden.reasonDescription.draft'
  },
  hub_only: {
    id: 'hidden-hub-only',
    text: 'apps.hidden.reason.hubOnly',
    description: 'apps.hidden.reasonDescription.hubOnly'
  },
  unpublished: {
    id: 'hidden-unpublished',
    text: 'apps.hidden.reason.unpublished',
    description: 'apps.hidden.reasonDescription.unpublished'
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
