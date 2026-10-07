/**
 * The Core beta campaigns' flags and enrolment records on disk. The decision itself is
 * `planCampaignArgs` in `coreBetaCampaigns.ts`.
 *
 * Campaign answers persist in their own `campaign-flags.json`, never `ops-flags.json`, so a
 * campaign write can never rebuild or resurrect slot #0's (898480's) saved answer. Each campaign
 * key is its own ops flag, fetched alongside the registry; a key first listed by this launch's
 * registry answer is fetched from the next launch on.
 */
import { initCoreBetaGrants } from './coreBetaGrants'
import {
  CAMPAIGN_REGISTRY_KEY,
  parseCampaignAnswer,
  parseCampaignRecords,
  parseCampaignRegistry
} from './coreBetaCampaigns'
import type { CampaignAnswer, CampaignRecords, CampaignRegistryEntry } from './coreBetaCampaigns'
import { makeOpsFlag, readPersistedFile, writePersistedEntry } from './opsFlag'
import type { OpsFlag } from './opsFlag'
import type { FeatureFlagValue } from './telemetry'

const CAMPAIGN_FLAGS_FILE = 'campaign-flags.json'
const ENROLMENTS_FILE = 'campaign-enrolments.json'

/** #1649's budget for 898480: wait longer while this machine holds something, so a cut lands
 *  this launch. Holding is a record here, not a saved answer: every machine saves the answer. */
function deadlineMs(enrolled: boolean): number {
  return enrolled ? 5000 : 3000
}

function makeRegistryFlag(): OpsFlag<CampaignRegistryEntry[]> {
  return makeOpsFlag({
    key: CAMPAIGN_REGISTRY_KEY,
    fallback: [],
    parse: parseCampaignRegistry,
    logLabel: 'core-campaigns',
    deadlineMs: () => deadlineMs(Object.keys(readCampaignRecords()).length > 0),
    persist: true,
    persistFile: CAMPAIGN_FLAGS_FILE
  })
}

let registry = makeRegistryFlag()
let campaigns = new Map<string, OpsFlag<CampaignAnswer | null>>()

/** Starts the registry and every campaign key the saved registry lists, in parallel, under one
 *  id. A beta-off boot calls nothing: campaigns never apply to it. */
export async function initCoreBetaCampaigns(opts: { distinctId: string }): Promise<void> {
  // Discovery reads the saved registry whatever its age: an expired one still names the keys
  // worth asking about, and only the live registry and fresh answers decide what applies.
  const saved = readPersistedFile(CAMPAIGN_FLAGS_FILE).entries[CAMPAIGN_REGISTRY_KEY] as
    | { value?: FeatureFlagValue; payload?: unknown }
    | undefined
  const listed = (saved && parseCampaignRegistry(saved.value, saved.payload)) ?? []
  for (const { key } of listed) {
    if (campaigns.has(key)) continue
    campaigns.set(
      key,
      makeOpsFlag<CampaignAnswer | null>({
        key,
        fallback: null,
        parse: parseCampaignAnswer,
        logLabel: `core-campaign ${key}`,
        deadlineMs: () => deadlineMs(readCampaignRecords()[key] !== undefined),
        persist: true,
        persistFile: CAMPAIGN_FLAGS_FILE
      })
    )
  }
  await Promise.all([registry, ...campaigns.values()].map((flag) => flag.init(opts)))
}

/** The boot fetch for every flag a Core beta decision reads, under ONE id, so slot #0 and the
 *  campaigns can never draw on different ids. `distinctId` may still be resolving. */
export async function initCoreBetaFlags(opts: {
  distinctId: string | Promise<string>
  betaEnabled: boolean
}): Promise<void> {
  const distinctId = await opts.distinctId
  await Promise.all([
    initCoreBetaGrants({ distinctId }),
    opts.betaEnabled ? initCoreBetaCampaigns({ distinctId }) : undefined
  ])
}

/** This launch's registry and the answers for the keys it lists. */
export async function getCoreBetaCampaigns(): Promise<{
  registry: CampaignRegistryEntry[]
  answers: Map<string, CampaignAnswer>
}> {
  const entries = await registry.get()
  const answers = new Map<string, CampaignAnswer>()
  for (const { key } of entries) {
    const answer = await campaigns.get(key)?.get()
    if (answer) answers.set(key, answer)
  }
  return { registry: entries, answers }
}

export function readCampaignRecords(): CampaignRecords {
  return parseCampaignRecords(readPersistedFile(ENROLMENTS_FILE).entries)
}

/** Whether the enrolment file's PRIMARY holds this record. `.bak` standing in for an unreadable
 *  primary doesn't count: the next launch reads the primary again, without the record. */
export function campaignRecordSaved(key: string, arg: string, epoch: number): boolean {
  const { entries, primaryUnreadable } = readPersistedFile(ENROLMENTS_FILE)
  return !primaryUnreadable && parseCampaignRecords(entries)[key]?.[arg]?.epoch === epoch
}

/** Records an enrolment. Throws when the file cannot be safely rewritten; the caller still
 *  applies the arg this launch, and the machine re-enrols while it draws `enrol`. */
export function writeCampaignRecord(key: string, arg: string, epoch: number, now: number): void {
  const existing = readCampaignRecords()[key] ?? {}
  writePersistedEntry(ENROLMENTS_FILE, key, { ...existing, [arg]: { epoch, enrolledAt: now } })
}

/** @internal */
export function _resetForTest(): void {
  registry._resetForTest()
  registry = makeRegistryFlag()
  campaigns = new Map()
}
