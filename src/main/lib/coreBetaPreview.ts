/**
 * Which Core beta grants a stopped install's next launch is eligible for, decided by the launch's
 * own `planCoreBetaArgs` over facts read without side effects. Commit ranges are proven against
 * the current HEAD and cached per (HEAD, commit), which never needs invalidating; a relation git
 * cannot prove is not cached, and its grant is not shown.
 */
import { MAX_RESOLVED_SHAS, proveCommitRelation } from './coreBetaAncestry'
import {
  NO_CORE_COMMITS,
  commitGrantShas,
  getCoreBetaGrantsAsync,
  planCoreBetaArgs,
  toBetaArgView
} from './coreBetaGrants'
import type { CoreCommitState } from './coreBetaGrants'
import { coreVersionState, resolveCoreCheckout, splitLaunchCommand } from './coreBetaInputs'
import { campaignCandidateGrants, planCampaignArgs } from './coreBetaCampaigns'
import { getCoreBetaCampaigns, readCampaignRecords } from './coreBetaCampaignFlags'
import { getIdClass } from './deviceId'
import { peekComfyArgsSchema } from './comfy-args'
import { withoutPygit2Breaker } from './git'
import { peekBetaFeaturesEnabled } from '../settings'
import type { CoreCheckout } from './version'
import type { InstallationRecord } from '../installations'
import type { LaunchCommand } from '../types/sources'
import type { BetaArgView, CoreBetaArgs } from '../../types/ipc'

/** A proof still running past this keeps going and caches its answer for the next request. */
export const PREVIEW_PROOF_BUDGET_MS = 5_000

const FULL_SHA_RE = /^[0-9a-f]{40}$/

const relations = new Map<string, boolean>()
const inFlight = new Map<string, Promise<boolean | null>>()

function relate(repoPath: string, head: string, sha: string): Promise<boolean | null> {
  const key = `${head}:${sha}`
  const known = relations.get(key)
  if (known !== undefined) return Promise.resolve(known)
  let pending = inFlight.get(key)
  if (!pending) {
    pending = withoutPygit2Breaker(() => proveCommitRelation(repoPath, sha, head))
      .then(
        (proof) => proof.relation,
        () => null
      )
      .then((relation) => {
        if (relation !== null) relations.set(key, relation)
        inFlight.delete(key)
        return relation
      })
    inFlight.set(key, pending)
  }
  return pending
}

async function previewCommits(
  repoPath: string,
  checkout: CoreCheckout,
  shas: readonly string[]
): Promise<CoreCommitState> {
  if (shas.length === 0 || checkout.kind !== 'head') return NO_CORE_COMMITS
  const head = checkout.commit.toLowerCase()
  if (!FULL_SHA_RE.test(head)) return NO_CORE_COMMITS
  const ancestry = new Map<string, boolean>()
  // Sequential: concurrent pygit2 spawns into one repository only contend.
  const work = (async () => {
    for (const sha of shas.slice(0, MAX_RESOLVED_SHAS)) {
      const relation = await relate(repoPath, head, sha)
      if (relation !== null) ancestry.set(sha, relation)
    }
  })()
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    work,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, PREVIEW_PROOF_BUDGET_MS)
    })
  ])
  clearTimeout(timer)
  return { head, ancestry: new Map(ancestry) }
}

/** `inst` with the args the settings view just committed, which can be ahead of the stored write. */
export function withCommittedArgs(
  inst: InstallationRecord,
  launchArgs: unknown
): InstallationRecord {
  return typeof launchArgs === 'string' ? { ...inst, launchArgs } : inst
}

export async function previewCoreBetaArgs(
  installationId: string,
  inst: InstallationRecord,
  launchCmd: LaunchCommand | null
): Promise<BetaArgView[]> {
  if (!launchCmd?.cmd) return []
  const split = splitLaunchCommand(launchCmd)
  if (!split) return []
  if (!peekBetaFeaturesEnabled()) return []
  const [grants, campaigns] = await Promise.all([getCoreBetaGrantsAsync(), getCoreBetaCampaigns()])
  const records = campaigns.answers.size > 0 ? readCampaignRecords() : {}
  const campaignGrants = campaignCandidateGrants(
    campaigns.registry,
    campaigns.answers,
    records,
    Date.now()
  )
  if (grants.length === 0 && campaignGrants.length === 0) return []
  // A launch without a schema injects no managed args; the args field fills this cache.
  const schema = peekComfyArgsSchema(
    split.mainPyAbs,
    installationId,
    inst.comfyVersion?.commit ?? (inst.version as string | undefined)
  )
  if (!schema) return []
  const checkout = resolveCoreCheckout(split.comfyuiDir)
  const commits = await previewCommits(
    split.comfyuiDir,
    checkout,
    commitGrantShas([...grants, ...campaignGrants], split.userArgs)
  )
  const core = coreVersionState(inst, checkout)
  const plan = planCoreBetaArgs({
    grants,
    betaEnabled: true,
    userArgs: split.userArgs,
    core,
    commits,
    schema
  })
  // Enrolments included; only a launch writes a record.
  const campaign = planCampaignArgs({
    ...campaigns,
    records,
    idClass: getIdClass(),
    now: Date.now(),
    betaEnabled: true,
    presentArgs: [...split.userArgs, ...plan.applied.map((grant) => grant.arg)],
    core,
    commits,
    schema
  })
  return [...plan.applied, ...campaign.applied.map((entry) => entry.grant)].map(toBetaArgView)
}

/** The beta-args pill's answer: the running session's grants, else the next-launch preview.
 *  Never throws: a failure anywhere costs the pill, never the settings view. */
export async function answerCoreBetaArgs(
  installationId: string,
  launchArgs: unknown,
  lookup: {
    /** `null` when the install is not running. */
    sessionArgs: (id: string) => readonly BetaArgView[] | null
    record: (id: string) => Promise<InstallationRecord | null>
    launchCommand: (inst: InstallationRecord) => LaunchCommand | null
  }
): Promise<CoreBetaArgs> {
  const none: CoreBetaArgs = { timing: 'next-launch', args: [] }
  try {
    const session = lookup.sessionArgs(installationId)
    if (session) return { timing: 'session', args: [...session] }
    const stored = await lookup.record(installationId)
    if (!stored) return none
    const inst = withCommittedArgs(stored, launchArgs)
    const args = await previewCoreBetaArgs(installationId, inst, lookup.launchCommand(inst))
    return { timing: 'next-launch', args }
  } catch (err) {
    console.warn('[get-core-beta-args] preview failed:', err)
    return none
  }
}

/** @internal */
export function _resetForTest(): void {
  relations.clear()
  inFlight.clear()
}
