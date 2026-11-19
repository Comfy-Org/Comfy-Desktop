export const PARTNER_REFUSAL_SIGNALS: readonly (string | RegExp)[] = [
  'content_filter',
  'content_moderation',
  'content_policy_violation',
  'datainspectionfailed',
  'image_content_policy_violation',
  'image_prohibited_content',
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
  'violates the content policy',
  'the provider rejected the audio track this model generated',
  'blocked this request with its content filter',
  'gemini api blocked the request',
  'declined to answer this request for safety reasons',
  "blocked by ideogram's content safety filter",
  "content blocked by google's responsible ai filters",
  'model refused to respond'
]

const ECHOED_REQUEST_KEYS = new Set(['request', 'input', 'inputs', 'params', 'parameters', 'text'])

function isEchoedRequestKey(key: string): boolean {
  const name = key.toLowerCase().replace(/[_-]/g, '')
  return ECHOED_REQUEST_KEYS.has(name) || /prompts?(?:text)?$/.test(name)
}

function withoutEchoedRequest(value: unknown): unknown {
  if (typeof value === 'string') return failureTextOf(value)
  if (Array.isArray(value)) return value.map(withoutEchoedRequest)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isEchoedRequestKey(key))
      .map(([key, item]): [string, unknown] => [key, withoutEchoedRequest(item)])
  )
}

function jsonObjectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      if (char === '\\') index++
      else if (char === '"') inString = false
    } else if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth++
    } else if (char === '}') {
      depth--
      if (depth === 0) return index + 1
    }
  }
  return -1
}

function parsedObject(source: string): object | undefined {
  try {
    const value: unknown = JSON.parse(source)
    return value !== null && typeof value === 'object' ? value : undefined
  } catch {
    return undefined
  }
}

function failureTextOf(message: string): string {
  let text = ''
  let index = 0
  for (let start = message.indexOf('{'); start !== -1; start = message.indexOf('{', index)) {
    const end = jsonObjectEnd(message, start)
    const object = end === -1 ? undefined : parsedObject(message.slice(start, end))
    if (object === undefined) {
      text += message.slice(index, start + 1)
      index = start + 1
    } else {
      text += message.slice(index, start) + JSON.stringify(withoutEchoedRequest(object))
      index = end
    }
  }
  return text + message.slice(index)
}

export function isPartnerRefusal(exceptionMessage: unknown): boolean {
  if (typeof exceptionMessage !== 'string' || exceptionMessage === '') return false
  const text = failureTextOf(exceptionMessage).toLowerCase()
  return PARTNER_REFUSAL_SIGNALS.some((signal) =>
    typeof signal === 'string' ? text.includes(signal) : signal.test(text)
  )
}
