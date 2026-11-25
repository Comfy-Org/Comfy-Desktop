import type { AppBadge, HiddenAppCard, HiddenAppReason } from '../types/ipc'

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

const DRAFT_PAGE_WORDS: ReasonWords = {
  id: 'hidden-draft-page',
  text: 'staffApps.opens.draft',
  description: 'staffApps.opensDescription.draft'
}

function chipOf(words: ReasonWords, t: (key: string) => string): AppBadge {
  return {
    id: words.id,
    style: 'chip',
    text: { en: t(words.text) },
    description: { en: t(words.description) }
  }
}

export function hiddenAppBadges(
  app: Pick<HiddenAppCard, 'reasons' | 'opens'>,
  t: (key: string) => string
): AppBadge[] {
  const opensDraft = app.opens === 'draft'
  const reasons = app.reasons.filter((reason) => !(opensDraft && reason === 'draft'))
  const chips = reasons.map((reason) => chipOf(REASON_WORDS[reason], t))
  return opensDraft ? [chipOf(DRAFT_PAGE_WORDS, t), ...chips] : chips
}
