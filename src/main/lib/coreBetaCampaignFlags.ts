import { initCoreBetaGrants } from './coreBetaGrants'
import { getIdClass } from './deviceId'
import {
  CAMPAIGN_REGISTRY_KEY,
  parseCampaignAnswer,
  parseCampaignRecords,
  parseCampaignRegistry
} from './coreBetaCampaigns'
import type { CampaignAnswer, CampaignRecords, CampaignRegistryEntry } from './coreBetaCampaigns'
import { makeOpsFlag, readPersistedFile, readPersistedResult, writePersistedEntry } from './opsFlag'
import type { OpsFlag } from './opsFlag'
import type { FeatureFlagValue } from './telemetry'

// Never ops-flags.json: a campaign write must not be able to rebuild or resurrect slot #0's answer.
const CAMPAIGN_FLAGS_FILE = 'campaign-flags.json'
const ENROLMENTS_FILE = 'campaign-enrolments.json'

const TIMEOUT_MS = 5000

function makeRegistryFlag(): OpsFlag<CampaignRegistryEntry[]> {
  return makeOpsFlag({
    key: CAMPAIGN_REGISTRY_KEY,
    fallback: [],
    parse: parseCampaignRegistry,
    logLabel: 'core-campaigns',
    timeoutMs: TIMEOUT_MS,
    persist: true,
    persistFile: CAMPAIGN_FLAGS_FILE
  })
}

let registry = makeRegistryFlag()
let campaigns = new Map<string, OpsFlag<CampaignAnswer | null>>()
let bootId: string | null = null
let savedOnly = false
let started = false

// QA-ONLY (OBL-118 integration build, never merged): one hard-coded campaign that grants
// --enable-agent replaces the PostHog registry, so no campaign flag is ever fetched. Unit tests
// (VITEST) keep the real path.
const QA_CAMPAIGNS = !process.env.VITEST
const QA_CAMPAIGN_KEY = 'qa_obl118_agent'

function qaCampaigns(): {
  registry: CampaignRegistryEntry[]
  answers: Map<string, CampaignAnswer>
} {
  const registry =
    parseCampaignRegistry(true, [{ key: QA_CAMPAIGN_KEY, args: ['--enable-agent'] }]) ?? []
  const answer = parseCampaignAnswer(
    'enrol',
    {
      grants: [
        { arg: '--enable-agent', min_core_version: '0.0.1', enrolment: { epoch: 1, epochs: [1] } }
      ]
    },
    Date.now()
  )
  return { registry, answers: new Map(answer ? [[QA_CAMPAIGN_KEY, answer]] : []) }
}

export async function initCoreBetaCampaigns(opts: { distinctId: string }): Promise<void> {
  started = true
  if (QA_CAMPAIGNS) return
  // Whatever its age: an expired registry still names the keys; only fresh answers decide.
  const saved: unknown = readPersistedFile(CAMPAIGN_FLAGS_FILE).entries[CAMPAIGN_REGISTRY_KEY]
  const { value, payload } = (saved ?? {}) as {
    value?: FeatureFlagValue
    payload?: unknown
  }
  const listed = parseCampaignRegistry(value, payload) ?? []
  for (const { key } of listed) {
    if (campaigns.has(key)) continue
    campaigns.set(
      key,
      makeOpsFlag<CampaignAnswer | null>({
        key,
        fallback: null,
        parse: parseCampaignAnswer,
        logLabel: `core-campaign ${key}`,
        timeoutMs: TIMEOUT_MS,
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
  // Only a hardware-derived id lasts: an answer drawn on any other and saved could enrol a later
  // launch under a different id. Such a launch cannot enrol, so it reads the saved answers (a
  // member still holds) and fetches and saves none.
  savedOnly = getIdClass() !== 'machine_derived'
  bootId = distinctId
  await Promise.all([
    initCoreBetaGrants({ distinctId }),
    opts.betaEnabled && !savedOnly ? initCoreBetaCampaigns({ distinctId }) : undefined
  ])
}

function readSavedCampaigns(): {
  registry: CampaignRegistryEntry[]
  answers: Map<string, CampaignAnswer>
} {
  const saved = readPersistedResult(CAMPAIGN_FLAGS_FILE, CAMPAIGN_REGISTRY_KEY)
  const registry = parseCampaignRegistry(saved?.value, saved?.payload) ?? []
  const answers = new Map<string, CampaignAnswer>()
  for (const { key } of registry) {
    const entry = readPersistedResult(CAMPAIGN_FLAGS_FILE, key)
    const answer = entry && parseCampaignAnswer(entry.value, entry.payload, entry.fetchedAt)
    if (answer) answers.set(key, answer)
  }
  return { registry, answers }
}

export async function getCoreBetaCampaigns(): Promise<{
  registry: CampaignRegistryEntry[]
  answers: Map<string, CampaignAnswer>
}> {
  if (QA_CAMPAIGNS) return qaCampaigns()
  if (savedOnly) return readSavedCampaigns()
  // Beta turned on after a beta-off boot: start the campaigns now, under the boot's id.
  if (!started && bootId !== null) await initCoreBetaCampaigns({ distinctId: bootId })
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

/** Throws when the file cannot be safely rewritten. Returns `false`, writing nothing, when the
 *  record already exists: a concurrent launch enrolled first, and keeps its `enrolledAt`. */
export function writeCampaignRecord(key: string, arg: string, epoch: number, now: number): boolean {
  const existing = parseCampaignRecords(readPersistedFile(ENROLMENTS_FILE, true).entries)[key] ?? {}
  if (existing[arg]?.epoch === epoch) return false
  writePersistedEntry(
    ENROLMENTS_FILE,
    key,
    { ...existing, [arg]: { epoch, enrolledAt: now } },
    true
  )
  return true
}

export function _resetForTest(): void {
  for (const flag of [registry, ...campaigns.values()]) flag._resetForTest()
  registry = makeRegistryFlag()
  campaigns = new Map()
  bootId = null
  savedOnly = false
  started = false
}
