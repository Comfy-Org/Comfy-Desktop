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

export async function startAgentPrefetch(
  installationId: string,
  request: PrefetchRequest
): Promise<void> {
  try {
    const index = indexKind(settings.getMirrorConfig())
    await new Promise<void>((resolve) => {
      const started = prefetchAgentRequirements(request, (report) => {
        resolve()
        if (!report) return
        reportAgentPrefetch(installationId, request.signature, index, report)
      })
      if (!started) resolve()
    })
  } catch (err) {
    console.warn('agent requirements: could not start the background download:', err)
  }
}

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
