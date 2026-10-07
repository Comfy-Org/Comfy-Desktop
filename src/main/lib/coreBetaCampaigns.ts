/**
 * Sticky, volume-gated Core beta campaigns: the pure decision.
 *
 * A campaign is its own PostHog flag with two variants. `enrol` (p% of machines) may enrol this
 * machine into a grant; every other machine (`hold`) gets the grant only if it enrolled on an
 * earlier launch. Closing a rollout is setting `enrol` to 0%: nobody new enrols, and enrolled
 * machines keep the arg. A registry flag lists the live campaign keys in order, with the args each
 * may grant, so a new campaign needs no Desktop release.
 *
 * Slot #0, the beta key (`coreBetaGrants.ts`), is decided first and untouched: its applied args
 * count as already on the command line here, so a campaign can neither repeat nor contradict one.
 *
 * KILLING a campaign: drop the record's epoch from `epochs`, remove the grant, unlist the key from
 * the registry, or serve `false` from a flag that stays ENABLED (a 0% release condition). Never
 * disable or delete a campaign flag or the registry: PostHog omits a disabled flag from `/flags`,
 * which reads as unreachable, so every machine keeps its saved answer for up to seven days.
 */
import {
  CORE_BETA_FEATURES_FLAG_KEY,
  oppositeArg,
  parseCoreBetaGrants,
  selectCoreBetaGrantArgs
} from './coreBetaGrants'
import type { CoreBetaGrant, CoreCommitState, CoreVersionState } from './coreBetaGrants'
import { filterUnsupportedArgs } from './comfy-args'
import type { ComfyArgsSchema } from './comfy-args'
import type { IdClass } from './deviceId'
import type { FeatureFlagValue } from './telemetry'

export const CAMPAIGN_REGISTRY_KEY = 'desktop_campaigns'

/** The variant that may enrol. Any other answer only holds. */
const ENROL_VARIANT = 'enrol'

const MAX_CAMPAIGNS = 8
const MAX_GRANTS = 32
const MAX_EPOCHS = 16
const CAMPAIGN_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/

/** How old an `enrol` answer may be and still enrol. Bounds the tail after a close: a machine
 *  that fetched `enrol` before it can still enrol from its saved answer for this long. Holding
 *  never checks it. */
export const ENROL_MAX_AGE_MS = 48 * 60 * 60 * 1000
/** Allowance for a clock that ran slightly ahead when the answer was saved. */
const ENROL_FUTURE_SKEW_MS = 60 * 60 * 1000
/** A held grant drops once its answer is older than this, two-sided like `opsFlag`'s
 *  `PERSIST_MAX_AGE_MS`. That one is only checked when Desktop boots; this is checked at every
 *  launch, so a session that stays open past the bound drops the grant too. */
export const HOLD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** The payload field handed, untouched, to the agent requirements override (OBL-018), which
 *  reads it through `appliedPassThrough` at #1559's install step. */
const AGENT_PASS_THROUGH_FIELD = 'agent_requirements_override'

export interface CampaignRegistryEntry {
  readonly key: string
  /** The only args this campaign may grant. */
  readonly args: readonly string[]
}

export interface CampaignGrant {
  readonly grant: CoreBetaGrant
  /** The epoch an `enrol` answer enrols into. */
  readonly epoch: number
  /** The epochs whose records still apply. Always contains `epoch`. */
  readonly epochs: readonly number[]
  /** Args that must already be on the command line, for enrolling and holding alike. */
  readonly requiresArgs: readonly string[]
}

export interface CampaignAnswer {
  readonly enrol: boolean
  readonly grants: readonly CampaignGrant[]
  /** The raw payload, for pass-through fields this layer never reads. */
  readonly payload: unknown
  /** When the server produced this answer. */
  readonly fetchedAt?: number
}

export interface CampaignRecord {
  readonly epoch: number
  readonly enrolledAt: number
}

/** Enrolments by campaign key, then arg. */
export type CampaignRecords = Readonly<Record<string, Readonly<Record<string, CampaignRecord>>>>

function isEnableArg(arg: unknown): arg is string {
  return typeof arg === 'string' && arg.startsWith('--enable-')
}

function isEpoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

/** The registry's ordered campaign list. Anything malformed lists nothing, which deactivates every
 *  campaign and keeps every record. */
export function parseCampaignRegistry(
  value: FeatureFlagValue | undefined,
  payload: unknown
): CampaignRegistryEntry[] | undefined {
  if (value === undefined) return undefined
  if (value === false || !Array.isArray(payload) || payload.length > MAX_CAMPAIGNS) return []
  const entries: CampaignRegistryEntry[] = []
  const seen = new Set<string>([CORE_BETA_FEATURES_FLAG_KEY, CAMPAIGN_REGISTRY_KEY])
  for (const candidate of payload) {
    if (!candidate || typeof candidate !== 'object') continue
    const { key, args } = candidate as { key?: unknown; args?: unknown }
    if (typeof key !== 'string' || !CAMPAIGN_KEY_RE.test(key) || seen.has(key)) continue
    if (!Array.isArray(args) || args.length === 0 || !args.every(isEnableArg)) continue
    seen.add(key)
    entries.push({ key, args: [...args] })
  }
  return entries
}

function parseCampaignGrant(candidate: unknown): CampaignGrant | null {
  const [grant] = parseCoreBetaGrants(true, { flags: [candidate] })
  if (grant === undefined || !isEnableArg(grant.arg)) return null
  // `parseCoreBetaGrants` accepted it, so it is an object.
  const { enrolment, requires_args } = candidate as { enrolment?: unknown; requires_args?: unknown }
  if (!enrolment || typeof enrolment !== 'object') return null
  const { epoch, epochs } = enrolment as { epoch?: unknown; epochs?: unknown }
  if (!isEpoch(epoch) || !Array.isArray(epochs) || epochs.length > MAX_EPOCHS) return null
  if (!epochs.every(isEpoch) || !epochs.includes(epoch)) return null
  let requiresArgs: string[] = []
  if (requires_args !== undefined) {
    if (!Array.isArray(requires_args) || !requires_args.every((arg) => typeof arg === 'string'))
      return null
    requiresArgs = [...requires_args]
  }
  return { grant, epoch, epochs: [...epochs], requiresArgs }
}

/**
 * One campaign key's answer. A malformed grant is dropped rather than degraded to a plain grant,
 * which would apply on every `hold` machine; a payload naming one arg twice grants nothing.
 */
export function parseCampaignAnswer(
  value: FeatureFlagValue | undefined,
  payload: unknown,
  fetchedAt?: number
): CampaignAnswer | undefined {
  if (value === undefined) return undefined
  const answer = { enrol: value === ENROL_VARIANT, payload, fetchedAt }
  const requested =
    value !== false && payload && typeof payload === 'object' && 'grants' in payload
      ? payload.grants
      : undefined
  if (!Array.isArray(requested) || requested.length > MAX_GRANTS) return { ...answer, grants: [] }
  const grants: CampaignGrant[] = []
  for (const candidate of requested) {
    const grant = parseCampaignGrant(candidate)
    if (grant !== null) grants.push(grant)
  }
  const args = new Set(grants.map(({ grant }) => grant.arg))
  return { ...answer, grants: args.size === grants.length ? grants : [] }
}

/** The enrolment file's content, keeping only well-formed records. Prototype-free, so a key such
 *  as `__proto__` or `constructor` in the file is just a key. */
export function parseCampaignRecords(entries: Record<string, unknown>): CampaignRecords {
  const records: Record<string, Record<string, CampaignRecord>> = Object.create(null)
  for (const [key, byArg] of Object.entries(entries)) {
    if (!byArg || typeof byArg !== 'object') continue
    for (const [arg, record] of Object.entries(byArg)) {
      const { epoch, enrolledAt } = (record ?? {}) as { epoch?: unknown; enrolledAt?: unknown }
      if (!isEpoch(epoch) || typeof enrolledAt !== 'number') continue
      ;(records[key] ??= Object.create(null))[arg] = { epoch, enrolledAt }
    }
  }
  return records
}

/** The record for (key, arg) when `candidate` still accepts its epoch. */
function heldRecord(
  records: CampaignRecords,
  key: string,
  candidate: CampaignGrant
): CampaignRecord | undefined {
  const record = records[key]?.[candidate.grant.arg]
  return record !== undefined && candidate.epochs.includes(record.epoch) ? record : undefined
}

/** The grants that can apply on this machine: listed for their campaign, and either drawn `enrol`
 *  or held by an accepted record. Only these are worth proving commit ranges for. */
export function campaignCandidateGrants(
  registry: readonly CampaignRegistryEntry[],
  answers: ReadonlyMap<string, CampaignAnswer>,
  records: CampaignRecords
): CoreBetaGrant[] {
  return registry.flatMap(({ key, args }) => {
    const answer = answers.get(key)
    if (!answer) return []
    return answer.grants
      .filter(
        (candidate) =>
          args.includes(candidate.grant.arg) &&
          (answer.enrol || heldRecord(records, key, candidate) !== undefined)
      )
      .map((candidate) => candidate.grant)
  })
}

export interface CampaignFacts {
  readonly registry: readonly CampaignRegistryEntry[]
  readonly answers: ReadonlyMap<string, CampaignAnswer>
  readonly records: CampaignRecords
  readonly betaEnabled: boolean
  /** The user's own args plus the args slot #0 applied this launch. */
  readonly presentArgs: readonly string[]
  readonly core: CoreVersionState
  readonly commits: CoreCommitState
  readonly schema: ComfyArgsSchema
  readonly idClass: IdClass
  readonly now: number
}

export interface CampaignApplied {
  readonly key: string
  readonly grant: CoreBetaGrant
  /** The record's epoch, or the new one when this launch enrolled. */
  readonly epoch: number
  /** This launch wrote the record. */
  readonly enrolledNow: boolean
  readonly payload: unknown
  /** When the answer that enrolled or held it was fetched. */
  readonly fetchedAt?: number
}

export type CampaignMissReason =
  | 'present'
  | 'requires_args'
  | 'gates'
  | 'unsupported'
  | 'stale_answer'
  | 'id_class'
  /** Enrolled this launch, but the record could not be written: running, not counted. */
  | 'record_failed'

/** A grant that did not apply on a machine that is enrolled (`member`) or drew `enrol`. */
export interface CampaignMiss {
  readonly key: string
  readonly arg: string
  readonly member: boolean
  readonly reason: CampaignMissReason
}

export interface CampaignPlan {
  readonly applied: readonly CampaignApplied[]
  readonly misses: readonly CampaignMiss[]
  readonly trace: readonly string[]
}

function answerFresh(
  answer: CampaignAnswer,
  now: number,
  maxAgeMs: number,
  skewMs: number
): boolean {
  if (answer.fetchedAt === undefined) return false
  const age = now - answer.fetchedAt
  return age <= maxAgeMs && age >= -skewMs
}

/** Campaign keys in registry order, each grant held or enrolled at most once per arg. */
export function planCampaignArgs(facts: CampaignFacts): CampaignPlan {
  const applied: CampaignApplied[] = []
  const misses: CampaignMiss[] = []
  const trace: string[] = []
  if (!facts.betaEnabled) return { applied, misses, trace }
  const present = new Set(facts.presentArgs)
  for (const { key, args } of facts.registry) {
    const answer = facts.answers.get(key)
    if (!answer) continue
    for (const candidate of answer.grants) {
      const { arg } = candidate.grant
      if (!args.includes(arg)) {
        trace.push(`[core-campaign] ${key}: ${arg} refused: not listed for this campaign`)
        continue
      }
      const record = heldRecord(facts.records, key, candidate)
      const member = record !== undefined
      if (!member && !answer.enrol) continue

      const miss = (reason: CampaignMissReason, detail: string): void => {
        misses.push({ key, arg, member, reason })
        trace.push(`[core-campaign] ${key}: ${arg} ${member ? 'idle' : 'not enrolled'}: ${detail}`)
      }
      const opposite = oppositeArg(arg)
      if (present.has(arg) || (opposite !== null && present.has(opposite))) {
        miss('present', 'already decided by the launch args or an earlier grant')
        continue
      }
      const missing = candidate.requiresArgs.filter((required) => !present.has(required))
      if (missing.length > 0) {
        miss('requires_args', `requires ${missing.join(' ')}`)
        continue
      }
      const withheld: string[] = []
      const selected = selectCoreBetaGrantArgs(
        [candidate.grant],
        facts.core,
        true,
        [],
        facts.commits,
        withheld,
        (line) => trace.push(line)
      )
      if (selected.length === 0) {
        miss('gates', withheld.join('; '))
        continue
      }
      if (filterUnsupportedArgs([arg], facts.schema).length === 0) {
        miss('unsupported', 'not supported by this core')
        continue
      }
      if (member && !answerFresh(answer, facts.now, HOLD_MAX_AGE_MS, HOLD_MAX_AGE_MS)) {
        miss('stale_answer', 'the answer holding it is older than 7 days')
        continue
      }
      if (!member) {
        if (!answerFresh(answer, facts.now, ENROL_MAX_AGE_MS, ENROL_FUTURE_SKEW_MS)) {
          miss('stale_answer', 'the enrol answer is missing a fetch time or older than 48 h')
          continue
        }
        if (facts.idClass !== 'machine_derived') {
          miss('id_class', `id class ${facts.idClass}`)
          continue
        }
      }
      const epoch = record?.epoch ?? candidate.epoch
      trace.push(`[core-campaign] ${key}: ${arg} ${member ? 'held' : 'enrolled'}, epoch ${epoch}`)
      present.add(arg)
      applied.push({
        key,
        grant: candidate.grant,
        epoch,
        enrolledNow: !member,
        payload: answer.payload,
        fetchedAt: answer.fetchedAt
      })
    }
  }
  return { applied, misses, trace }
}

/** The raw `agent_requirements_override` of the campaign that applied `arg` this launch, or
 *  `undefined` when no campaign did. Opaque here: the override module validates it. */
export function appliedPassThrough(applied: readonly CampaignApplied[], arg: string): unknown {
  const payload = applied.find((entry) => entry.grant.arg === arg)?.payload
  if (!payload || typeof payload !== 'object') return undefined
  return (payload as Record<string, unknown>)[AGENT_PASS_THROUGH_FIELD]
}
