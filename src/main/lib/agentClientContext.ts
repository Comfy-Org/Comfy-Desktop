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

type HardwareProbe = () => Promise<{ gpu_tier?: unknown }>
let hardwareProbe: HardwareProbe | null = null

export function setHardwareProbe(probe: HardwareProbe | null): void {
  hardwareProbe = probe
}

async function gpuTierWithin(ms: number): Promise<GpuTier | undefined> {
  if (!hardwareProbe) return undefined
  const probed = hardwareProbe().then(
    (h) => h.gpu_tier as GpuTier | undefined,
    () => undefined
  )
  const timedOut = new Promise<undefined>((resolve) => setTimeout(resolve, ms))
  return Promise.race([probed, timedOut])
}

export async function agentClientContext(
  telemetryGranted: boolean,
  appVersion: string
): Promise<AgentClientContext | undefined> {
  if (!telemetryGranted) return undefined
  const gpuTier = await gpuTierWithin(MAX_GPU_TIER_WAIT_MS)
  return { channel: deriveAppChannel(appVersion), ...(gpuTier ? { gpuTier } : {}) }
}
