import * as installations from '../installations'
import * as settings from '../settings'
import {
  planAgentRequirementsInstall,
  prefetchAgentRequirements,
  prepareAgentPrefetch
} from './agentRequirementsLaunch'
import type { PrefetchRequest } from './agentRequirementsLaunch'
import {
  indexKind,
  nextPrefetchAttempt,
  readOverrideState,
  readPrefetchState,
  reportAgentPrefetch
} from './agentRequirementsOverride'
import { getCoreBetaCampaigns } from './coreBetaCampaignFlags'
import { enrolledAgentOverride } from './coreBetaCampaigns'

/**
 * Start a background download of the agent's packages, counting its attempt per signature.
 * Resolves once it is done, or at once when one is already running for the install. Never throws.
 */
export async function startAgentPrefetch(
  installationId: string,
  request: PrefetchRequest
): Promise<void> {
  try {
    const attempt = nextPrefetchAttempt(
      readPrefetchState(await installations.get(installationId)),
      request.signature
    )
    const index = indexKind(settings.getMirrorConfig())
    await new Promise<void>((resolve) => {
      const started = prefetchAgentRequirements(request, (report) => {
        resolve()
        // An eager run that found everything cached did nothing worth counting.
        if (!report) return
        reportAgentPrefetch(installationId, request.signature, attempt, index, report)
        void installations
          .update(installationId, {
            agentPrefetch: { signature: request.signature, attempts: attempt }
          })
          .catch((err: unknown) => {
            console.warn('agent requirements: could not record the background download:', err)
          })
      })
      if (!started) resolve()
    })
  } catch (err) {
    console.warn('agent requirements: could not start the background download:', err)
  }
}

/**
 * Ahead of any launch: fetch the agent's packages for every install a campaign answer would enrol
 * into the agent, one install at a time, so a link of any speed usually has them cached by the
 * launch that enables it. Every managed install that ships the agent's file is fetched for: which
 * of them the answer's version range admits is only settled at launch. Never throws.
 */
export async function prefetchEnrolledAgents(): Promise<void> {
  try {
    if (!settings.peekBetaFeaturesEnabled()) return
    const enrolled = enrolledAgentOverride((await getCoreBetaCampaigns()).answers)
    if (!enrolled) return
    for (const inst of await installations.list()) {
      const plan = planAgentRequirementsInstall(inst, ['--enable-agent'])
      if (!plan) continue
      const request = await prepareAgentPrefetch(plan, enrolled.override, readOverrideState(inst))
      if (request) await startAgentPrefetch(inst.id, request)
    }
  } catch (err) {
    console.warn('agent requirements: could not download ahead of a launch:', err)
  }
}
