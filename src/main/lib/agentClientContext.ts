import type { GpuTier } from '../../shared/gpuTier'
import { deriveAppChannel } from './telemetry'

/** Env names the cloud comfy-agent reads (services/agent/local/config). */
export const AGENT_CLIENT_ENV_VARS = [
  'AGENT_CLIENT_CONTEXT',
  'AGENT_CLIENT_CHANNEL',
  'AGENT_CLIENT_GPU_TIER'
] as const

export interface AgentClientContext {
  channel: string
  gpuTier?: GpuTier
}

const MAX_GPU_TIER_WAIT_MS = 2000

type HardwareProbe = () => Promise<{ gpu_tier?: unknown } | null | undefined>
let hardwareProbe: HardwareProbe | null = null

export function setHardwareProbe(probe: HardwareProbe | null): void {
  hardwareProbe = probe
}

async function gpuTierWithin(): Promise<GpuTier | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), MAX_GPU_TIER_WAIT_MS)
  })
  try {
    if (!hardwareProbe) return undefined
    const tier = (await Promise.race([hardwareProbe(), timedOut]))?.gpu_tier
    return typeof tier === 'string' && tier ? (tier as GpuTier) : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

export async function agentClientContext(
  telemetryGranted: boolean,
  appVersion: string
): Promise<AgentClientContext | undefined> {
  if (!telemetryGranted) return undefined
  const gpuTier = await gpuTierWithin()
  return { channel: deriveAppChannel(appVersion), ...(gpuTier ? { gpuTier } : {}) }
}
