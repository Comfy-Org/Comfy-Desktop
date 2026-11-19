export const PARTNER_REFUSAL_SIGNALS: readonly (string | RegExp)[] = [
  'content_filter',
  'content_moderation',
  'content_policy_violation',
  'datainspectionfailed',
  'image_content_policy_violation',
  'imagine:content-moderated',
  'moderation_blocked',
  'sensitivecontentdetected',
  /\b(?:input_preprocessing\.safety|safety\.(?:input|output))\.(?:audio|image|multimodal|text|video)\b/,
  'content moderated',
  'request moderated',
  /["']status["']\s*:\s*["']nsfw["']/,
  'blocked by content policy',
  'blocked due to safety',
  'content policy violation',
  'did not pass content moderation',
  'flagged by the content moderation',
  'failure to pass the risk control system',
  'may contain inappropriate content',
  'nsfw content detected',
  'rejected by the safety system',
  'rejected by risk control',
  'violates our content policy',
  'violates the content policy'
]

export function isPartnerRefusal(exceptionMessage: unknown): boolean {
  if (typeof exceptionMessage !== 'string' || exceptionMessage === '') return false
  const text = exceptionMessage.toLowerCase()
  return PARTNER_REFUSAL_SIGNALS.some((signal) =>
    typeof signal === 'string' ? text.includes(signal) : signal.test(text)
  )
}
