import { isPersistableTemplateId, thumbnailUrlFor } from '../sources/standalone/curatedTemplates'
import type {
  TemplateSearchCandidate,
  TemplateSearchOutcome,
  TemplateSearchResult
} from '../../types/ipc'
import type { FetchLike, TemplateSearchBackend } from './types'

export const RUN_LIMIT = 3
export const DOWNLOAD_LIMIT = 2
export const ALSO_TRY_LIMIT = 3
const REQUESTED_CANDIDATES = 8
const TIMEOUT_MS = 3000
const DECIDE_PATH = '/api/decide'
const PARTNER_PREFIX = 'api_'
const OUTCOMES: ReadonlySet<string> = new Set<TemplateSearchOutcome>([
  'template',
  'agent',
  'bad_input',
  'unsat'
])

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asTexts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => !!asText(item)) : []
}

function isUnmaskedOption(value: unknown): boolean {
  const option = asRecord(value)
  return option !== null && option.masked == null
}

function isOutcome(value: unknown): value is TemplateSearchOutcome {
  return typeof value === 'string' && OUTCOMES.has(value)
}

export function isPartnerTemplate(templateId: string): boolean {
  return templateId.startsWith(PARTNER_PREFIX)
}

export function decisionEndpoint(base: string): string | null {
  let url: URL
  try {
    url = new URL(base)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return new URL(DECIDE_PATH, url).toString()
}

function candidateFrom(value: unknown): TemplateSearchCandidate | null {
  const candidate = asRecord(value)
  const variant = asRecord(candidate?.variant)
  const templateId = variant?.template_id
  if (!candidate || !variant || !isPersistableTemplateId(templateId)) return null
  return {
    templateId,
    title: asText(variant.title) ?? templateId,
    thumbnailUrl: thumbnailUrlFor(templateId, 'webp'),
    family: asText(candidate.family_id),
    partner: isPartnerTemplate(templateId),
    rewrite: candidate.kind === 'rewrite',
    missing: asTexts(candidate.download).filter((item) => item !== templateId)
  }
}

function distinctCandidates(
  value: unknown,
  limit: number,
  taken: ReadonlySet<string> = new Set()
): TemplateSearchCandidate[] {
  const seen = new Set(taken)
  const candidates: TemplateSearchCandidate[] = []
  for (const item of Array.isArray(value) ? value : []) {
    if (candidates.length === limit) break
    const candidate = candidateFrom(item)
    if (!candidate || seen.has(candidate.templateId)) continue
    seen.add(candidate.templateId)
    candidates.push(candidate)
  }
  return candidates
}

export function parseDecision(body: unknown): TemplateSearchResult | null {
  const decision = asRecord(body)
  const outcome = asRecord(decision?.outcome)
  const split = asRecord(decision?.split)
  if (!outcome || !split || !isOutcome(outcome.kind)) return null
  const run = distinctCandidates(split.run, RUN_LIMIT)
  const download = distinctCandidates(
    split.download,
    DOWNLOAD_LIMIT,
    new Set(run.map((candidate) => candidate.templateId))
  )
  const options = Array.isArray(decision?.options) ? decision.options : []
  const alsoTry = distinctCandidates(
    options.filter(isUnmaskedOption),
    ALSO_TRY_LIMIT,
    new Set([...run, ...download].map((candidate) => candidate.templateId))
  )
  return { outcome: outcome.kind, reply: asText(outcome.reply), run, download, alsoTry }
}

export function createDecisionApiBackend(
  endpoint: string,
  fetch: FetchLike
): TemplateSearchBackend {
  return {
    async search(query) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: query,
          writer: 'off',
          run_n: REQUESTED_CANDIDATES,
          download_m: REQUESTED_CANDIDATES
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      if (!response.ok) throw new Error(`the decision service answered ${response.status}`)
      const result = parseDecision(await response.json())
      if (!result) throw new Error('the decision service sent a decision Desktop cannot read')
      return result
    }
  }
}
