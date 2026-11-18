import { isPersistableTemplateId } from '../sources/standalone/curatedTemplates'
import type {
  TemplateSearchCandidate,
  TemplateSearchInput,
  TemplateSearchOutcome,
  TemplateSearchResult
} from '../../types/ipc'
import { asRecord, type JsonRecord } from './json'

export const RUN_LIMIT = 3
export const DOWNLOAD_LIMIT = 2
export const ALSO_TRY_LIMIT = 3
export const MORE_LIMIT = 12
const REQUESTED_CANDIDATES = 8
const REQUESTED_SIBLINGS = 6
const PARTNER_PREFIX = 'api_'
const OUTCOMES: readonly TemplateSearchOutcome[] = [
  'template',
  'agent',
  'bad_input',
  'unsat',
  'download'
]
const KNOWN_OUTCOMES: ReadonlySet<string> = new Set(OUTCOMES)
const INPUTS: ReadonlySet<string> = new Set<TemplateSearchInput>(['image', 'video', 'audio'])

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

function listsFiles(value: unknown): boolean {
  return asTexts(asRecord(value)?.download).length > 0
}

function familyOf(value: unknown): string | null {
  return asText(asRecord(value)?.family_id)
}

function inputsOf(value: unknown): TemplateSearchInput[] {
  return asTexts(value).filter((kind): kind is TemplateSearchInput => INPUTS.has(kind))
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
    needsDownload:
      fromDownloadList || listsFiles(candidate) || maskCode(candidate) === NOT_INSTALLED,
    score: asNumber(candidate.score),
    calibrated: asNumber(candidate.calibrated),
    belowThreshold: isBelowThreshold(candidate),
    needs: inputsOf(variant.needs),
    downloadBytes: null
  }
}

function distinctCandidates(
  value: unknown,
  limit: number,
  describe: DescribeTemplate,
  {
    taken = new Set<string>(),
    fromDownloadList = false
  }: {
    taken?: ReadonlySet<string>
    fromDownloadList?: boolean
  } = {}
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

function openBesideItsPick(
  picks: TemplateSearchCandidate[],
  open: TemplateSearchCandidate[],
  limit: number
): TemplateSearchCandidate[] {
  const rest = [...open]
  const shown: TemplateSearchCandidate[] = []
  for (const pick of picks) {
    shown.push(pick)
    const alternative = rest.findIndex(
      (other) => other.family !== null && other.family === pick.family
    )
    if (alternative >= 0) shown.push(...rest.splice(alternative, 1))
  }
  return [...shown, ...rest].slice(0, limit)
}

type CardLists = Pick<TemplateSearchResult, 'run' | 'download' | 'more'>

function templateIds(...lists: TemplateSearchCandidate[][]): Set<string> {
  return new Set(lists.flat().map((candidate) => candidate.templateId))
}

function answerCards(split: JsonRecord, describe: DescribeTemplate): CardLists {
  const open = Array.isArray(split.open) ? split.open : []
  const picks = distinctCandidates(split.run, Infinity, describe)
  const run = openBesideItsPick(
    picks,
    distinctCandidates(
      open.filter((item) => !listsFiles(item)),
      Infinity,
      describe,
      { taken: templateIds(picks) }
    ),
    RUN_LIMIT
  )
  const downloads = Array.isArray(split.download) ? split.download : []
  const runFamilies = new Set(run.map((candidate) => candidate.family))
  const openBesideShownPick = (item: unknown): boolean => {
    const family = familyOf(item)
    return listsFiles(item) && family !== null && runFamilies.has(family)
  }
  const download = distinctCandidates(
    [...open.filter(openBesideShownPick), ...downloads],
    DOWNLOAD_LIMIT,
    describe,
    { taken: templateIds(run), fromDownloadList: true }
  )
  const shownFamilies = new Set([...run, ...download].map((candidate) => candidate.family))
  const siblings = (Array.isArray(split.more) ? split.more : []).filter((item) => {
    const family = familyOf(item)
    return family !== null && shownFamilies.has(family)
  })
  const more = distinctCandidates(siblings, MORE_LIMIT, describe, {
    taken: templateIds(run, download)
  })
  return { run, download, more }
}

function unscored(candidate: TemplateSearchCandidate): TemplateSearchCandidate {
  return { ...candidate, score: null, calibrated: null, belowThreshold: false }
}

function lookupCards(split: JsonRecord, describe: DescribeTemplate): CardLists {
  const run = distinctCandidates(split.run, Infinity, describe)
  const download = distinctCandidates(split.download, Infinity, describe, {
    taken: templateIds(run),
    fromDownloadList: true
  })
  const more = distinctCandidates(split.more, Infinity, describe, {
    taken: templateIds(run, download)
  })
  return { run: run.map(unscored), download: download.map(unscored), more: more.map(unscored) }
}

export function parseDecision(
  body: unknown,
  describe: DescribeTemplate = () => null
): TemplateSearchResult | null {
  const decision = asRecord(body)
  const outcome = asRecord(decision?.outcome)
  const split = asRecord(decision?.split)
  if (!outcome || !split) return null
  const names = asTexts(outcome.matched)
  const matched = names.length ? names : null
  const cards = matched ? lookupCards(split, describe) : answerCards(split, describe)
  const options = Array.isArray(decision?.options) ? decision.options : []
  const alsoTry = matched
    ? []
    : distinctCandidates(options.filter(isOfferableOption), ALSO_TRY_LIMIT, describe, {
        taken: templateIds(cards.run, cards.download, cards.more)
      })
  return {
    outcome: outcomeOf(outcome.kind),
    reply: asText(outcome.reply),
    ...cards,
    alsoTry,
    matched,
    partnerSwitch: false,
    partnersShown: true
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

export function decideRequest(
  query: string,
  installed: readonly string[] | null,
  { partnersOff = false }: { partnersOff?: boolean } = {}
): object {
  return {
    text: query,
    run_n: REQUESTED_CANDIDATES,
    download_m: REQUESTED_CANDIDATES,
    siblings_n: REQUESTED_SIBLINGS,
    outcomes: OUTCOMES,
    ...(installed ? { installed } : {}),
    ...(partnersOff ? { partner_on: false } : {})
  }
}
