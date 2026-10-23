import * as installations from '../installations'
import * as settings from '../settings'
import {
  agentPrefetchesStopped,
  planAgentRequirementsInstall,
  prefetchAgentRequirements,
  prepareAgentPrefetch,
  reapOrphanedAgentUv
} from './agentRequirementsLaunch'
import type { PrefetchRequest } from './agentRequirementsLaunch'
import { indexKind, readOverrideState, reportAgentPrefetch } from './agentRequirementsOverride'
import { getCoreBetaCampaigns } from './coreBetaCampaignFlags'
import { enrolledAgentOverride } from './coreBetaCampaigns'
import { getIdClass } from './deviceId'

/**
 * Start a background download of the agent's packages.
 * Resolves once it is done, or at once when one is already running for the install. Never throws.
 */
export async function startAgentPrefetch(
  installationId: string,
  request: PrefetchRequest
): Promise<void> {
  try {
    const index = indexKind(settings.getMirrorConfig())
    await new Promise<void>((resolve) => {
      const started = prefetchAgentRequirements(request, (report) => {
        resolve()
        // An eager run that found everything cached did nothing worth counting.
        if (!report) return
        reportAgentPrefetch(installationId, request.signature, index, report)
      })
      if (!started) resolve()
    })
  } catch (err) {
    console.warn('agent requirements: could not start the background download:', err)
  }
}

/**
 * Ahead of any launch: fetch the agent's packages for every install once a campaign answer would
 * enrol this machine into the agent, one install at a time, so a link of any speed usually has them cached by the
 * launch that enables it. Every managed install that ships the agent's file is fetched for: which
 * of them the answer's version range admits is only settled at launch. Never throws.
 */
export async function prefetchEnrolledAgents(): Promise<void> {
  try {
    if (!settings.peekBetaFeaturesEnabled()) return
    const enrolled = enrolledAgentOverride(await getCoreBetaCampaigns(), Date.now(), getIdClass())
    if (!enrolled) return
    for (const inst of await installations.list()) {
      if (agentPrefetchesStopped()) return
      try {
        const plan = planAgentRequirementsInstall(inst, ['--enable-agent'])
        if (!plan) continue
        await reapOrphanedAgentUv(plan.installPath)
        const request = await prepareAgentPrefetch(plan, enrolled.override, readOverrideState(inst))
        if (request) await startAgentPrefetch(inst.id, request)
      } catch (err) {
        console.warn(
          `agent requirements: could not download ahead of a launch for ${inst.id}:`,
          err
        )
      }
    }
  } catch (err) {
    console.warn('agent requirements: could not download ahead of a launch:', err)
  }
}
