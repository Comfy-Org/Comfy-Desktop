import { isPersistableTemplateId } from '../sources/standalone/curatedTemplates'
import type {
  TemplateSearchCandidate,
  TemplateSearchOutcome,
  TemplateSearchResult
} from '../../types/ipc'
import { asRecord, type JsonRecord } from './json'

export const RUN_LIMIT = 3
export const DOWNLOAD_LIMIT = 2
export const ALSO_TRY_LIMIT = 3
const REQUESTED_CANDIDATES = 8
const PARTNER_PREFIX = 'api_'
const OUTCOMES: readonly TemplateSearchOutcome[] = [
  'template',
  'agent',
  'bad_input',
  'unsat',
  'download'
]
const KNOWN_OUTCOMES: ReadonlySet<string> = new Set(OUTCOMES)

export interface TemplateLabel {
  title: string
  thumbnailUrl: string | null
  partner: boolean
}

export type DescribeTemplate = (templateId: string) => TemplateLabel | null

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asTexts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => !!asText(item)) : []
}

const NOT_INSTALLED = 'not_installed'

function maskCode(value: unknown): string | null {
  return asText(asRecord(asRecord(value)?.masked)?.code)
}

function isOfferableOption(value: unknown): boolean {
  const option = asRecord(value)
  return option !== null && (option.masked == null || maskCode(option) === NOT_INSTALLED)
}

function missingFor(candidate: JsonRecord, templateId: string): string[] {
  const listed = asTexts(candidate.download)
  const masked = asText(asRecord(candidate.masked)?.detail)
  const items = listed.length ? listed : masked ? masked.split(',').map((item) => item.trim()) : []
  return items.filter((item) => item && item !== templateId)
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isBelowThreshold(candidate: JsonRecord): boolean {
  if (typeof candidate.clears === 'boolean') return !candidate.clears
  const score = asNumber(candidate.score)
  const threshold = asNumber(candidate.threshold)
  return score !== null && threshold !== null && score < threshold
}

function outcomeOf(value: unknown): TemplateSearchOutcome {
  return typeof value === 'string' && KNOWN_OUTCOMES.has(value)
    ? (value as TemplateSearchOutcome)
    : 'unsat'
}

export function isPartnerTemplate(templateId: string): boolean {
  return templateId.startsWith(PARTNER_PREFIX)
}

function candidateFrom(
  value: unknown,
  fromDownloadList: boolean,
  describe: DescribeTemplate
): TemplateSearchCandidate | null {
  const candidate = asRecord(value)
  const variant = asRecord(candidate?.variant)
  const templateId = variant?.template_id
  if (!candidate || !variant || !isPersistableTemplateId(templateId)) return null
  const label = describe(templateId)
  return {
    templateId,
    title: label?.title ?? asText(variant.title) ?? templateId,
    thumbnailUrl: label?.thumbnailUrl ?? null,
    family: asText(candidate.family_id),
    partner: label?.partner === true || isPartnerTemplate(templateId),
    needsDownload: fromDownloadList || maskCode(candidate) === NOT_INSTALLED,
    score: asNumber(candidate.score),
    calibrated: asNumber(candidate.calibrated),
    belowThreshold: isBelowThreshold(candidate),
    missing: missingFor(candidate, templateId)
  }
}

function distinctCandidates(
  value: unknown,
  limit: number,
  describe: DescribeTemplate,
  {
    taken = new Set<string>(),
    fromDownloadList = false
  }: { taken?: ReadonlySet<string>; fromDownloadList?: boolean } = {}
): TemplateSearchCandidate[] {
  const seen = new Set(taken)
  const candidates: TemplateSearchCandidate[] = []
  for (const item of Array.isArray(value) ? value : []) {
    if (candidates.length === limit) break
    const candidate = candidateFrom(item, fromDownloadList, describe)
    if (!candidate || seen.has(candidate.templateId)) continue
    seen.add(candidate.templateId)
    candidates.push(candidate)
  }
  return candidates
}

export function parseDecision(
  body: unknown,
  describe: DescribeTemplate = () => null
): TemplateSearchResult | null {
  const decision = asRecord(body)
  const outcome = asRecord(decision?.outcome)
  const split = asRecord(decision?.split)
  if (!outcome || !split) return null
  const run = distinctCandidates(split.run, RUN_LIMIT, describe)
  const download = distinctCandidates(split.download, DOWNLOAD_LIMIT, describe, {
    taken: new Set(run.map((candidate) => candidate.templateId)),
    fromDownloadList: true
  })
  const options = Array.isArray(decision?.options) ? decision.options : []
  const alsoTry = distinctCandidates(options.filter(isOfferableOption), ALSO_TRY_LIMIT, describe, {
    taken: new Set([...run, ...download].map((candidate) => candidate.templateId))
  })
  return {
    outcome: outcomeOf(outcome.kind),
    reply: asText(outcome.reply),
    run,
    download,
    alsoTry
  }
}

export interface DecisionMetrics {
  processMs: number | null
  bundleVersion: string | null
}

export function decisionMetrics(body: unknown): DecisionMetrics {
  const decision = asRecord(body)
  const latency = asRecord(decision?.latency_ms)
  const total = asNumber(latency?.total)
  return {
    processMs: total === null ? null : Math.round(total),
    bundleVersion: asText(asRecord(decision?.bundle)?.version)
  }
}

export function decideRequest(query: string, installed: readonly string[] | null): object {
  return {
    text: query,
    run_n: REQUESTED_CANDIDATES,
    download_m: REQUESTED_CANDIDATES,
    outcomes: OUTCOMES,
    ...(installed ? { installed } : {})
  }
}
