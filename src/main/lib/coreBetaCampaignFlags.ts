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

// Never ops-flags.json: a campaign write must not be able to rebuild or resurrect slot #0's answer.
const CAMPAIGN_FLAGS_FILE = 'campaign-flags.json'
const ENROLMENTS_FILE = 'campaign-enrolments.json'

/** Holding means a record here, not a saved answer as for slot #0: every machine saves one. */
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

export async function initCoreBetaCampaigns(opts: { distinctId: string }): Promise<void> {
  // Whatever its age: an expired registry still names the keys; only fresh answers decide.
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

/** Slot #0 and the campaigns under ONE id, so they can never draw on different ids. */
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
  return parseCampaignRecords(readPersistedFile(ENROLMENTS_FILE, true).entries)
}

/** `.bak` standing in for an unreadable primary doesn't count: the next launch rereads the primary. */
export function campaignRecordSaved(key: string, arg: string, epoch: number): boolean {
  const { entries, primaryUnreadable } = readPersistedFile(ENROLMENTS_FILE, true)
  return !primaryUnreadable && parseCampaignRecords(entries)[key]?.[arg]?.epoch === epoch
}

/** Throws when the file cannot be safely rewritten. */
export function writeCampaignRecord(key: string, arg: string, epoch: number, now: number): void {
  const existing = readCampaignRecords()[key] ?? {}
  writePersistedEntry(
    ENROLMENTS_FILE,
    key,
    { ...existing, [arg]: { epoch, enrolledAt: now } },
    true
  )
}

export function _resetForTest(): void {
  registry._resetForTest()
  registry = makeRegistryFlag()
  campaigns = new Map()
}
