import { initCoreBetaGrants, refreshCoreBetaGrants } from './coreBetaGrants'
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

export async function initCoreBetaCampaigns(opts: { distinctId: string }): Promise<void> {
  started = true
  const saved: unknown = readPersistedFile(CAMPAIGN_FLAGS_FILE).entries[CAMPAIGN_REGISTRY_KEY]
  const { value, payload } = (saved ?? {}) as {
    value?: FeatureFlagValue
    payload?: unknown
  }
  const listed = parseCampaignRegistry(value, payload) ?? []
  startCampaignFlags(listed, opts.distinctId)
  await Promise.all([registry, ...campaigns.values()].map((flag) => flag.init(opts)))
  await Promise.all(startCampaignFlags(await registry.get(), opts.distinctId))
}

function startCampaignFlags(
  listed: readonly CampaignRegistryEntry[],
  distinctId: string
): Promise<void>[] {
  const inits: Promise<void>[] = []
  for (const { key } of listed) {
    if (campaigns.has(key)) continue
    const flag = makeOpsFlag<CampaignAnswer | null>({
      key,
      fallback: null,
      parse: parseCampaignAnswer,
      logLabel: `core-campaign ${key}`,
      timeoutMs: TIMEOUT_MS,
      persist: true,
      persistFile: CAMPAIGN_FLAGS_FILE
    })
    campaigns.set(key, flag)
    inits.push(flag.init({ distinctId }))
  }
  return inits
}

export async function initCoreBetaFlags(opts: {
  distinctId: string | Promise<string>
  betaEnabled: boolean
}): Promise<void> {
  const distinctId = await opts.distinctId
  savedOnly = getIdClass() !== 'machine_derived'
  bootId = distinctId
  await Promise.all([
    initCoreBetaGrants({ distinctId }),
    opts.betaEnabled && !savedOnly ? initCoreBetaCampaigns({ distinctId }) : undefined
  ])
}

export async function refreshCoreBetaFlags(): Promise<void> {
  if (bootId === null) return
  await Promise.all([
    refreshCoreBetaGrants(),
    ...(started ? [registry, ...campaigns.values()].map((flag) => flag.refresh()) : [])
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
  if (savedOnly) return readSavedCampaigns()
  if (!started && bootId !== null) await initCoreBetaCampaigns({ distinctId: bootId })
  const entries = await registry.get()
  if (bootId !== null) startCampaignFlags(entries, bootId)
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
