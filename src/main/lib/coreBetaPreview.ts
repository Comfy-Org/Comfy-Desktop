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
import { peekComfyArgsSchema } from './comfy-args'
import { withoutPygit2Breaker } from './git'
import { peekBetaFeaturesEnabled } from '../settings'
import type { CoreCheckout } from './version'
import type { InstallationRecord } from '../installations'
import type { LaunchCommand } from '../types/sources'
import type { BetaArgView } from '../../types/ipc'

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
  const grants = await getCoreBetaGrantsAsync()
  if (grants.length === 0) return []
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
    commitGrantShas(grants, split.userArgs)
  )
  const plan = planCoreBetaArgs({
    grants,
    betaEnabled: true,
    userArgs: split.userArgs,
    core: coreVersionState(inst, checkout),
    commits,
    schema
  })
  return plan.applied.map(toBetaArgView)
}

/** @internal */
export function _resetForTest(): void {
  relations.clear()
  inFlight.clear()
}
