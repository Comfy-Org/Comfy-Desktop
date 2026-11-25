import type { GpuTier } from '../../shared/gpuTier'
import { deriveAppChannel } from './telemetry'

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

type ProbedHardware = Record<string, unknown> | null | undefined
type HardwareProbe = () => Promise<ProbedHardware>
let hardwareProbe: HardwareProbe | null = null

export function setHardwareProbe(probe: HardwareProbe | null): void {
  hardwareProbe = probe
}

export async function hardwareWithin(waitMs: number): Promise<ProbedHardware> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), waitMs)
  })
  try {
    if (!hardwareProbe) return undefined
    return await Promise.race([hardwareProbe(), timedOut])
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

async function gpuTierWithin(): Promise<GpuTier | undefined> {
  const tier = (await hardwareWithin(MAX_GPU_TIER_WAIT_MS))?.['gpu_tier']
  return typeof tier === 'string' && tier ? (tier as GpuTier) : undefined
}

export async function agentClientContext(
  telemetryGranted: boolean,
  appVersion: string
): Promise<AgentClientContext | undefined> {
  if (!telemetryGranted) return undefined
  const gpuTier = await gpuTierWithin()
  return { channel: deriveAppChannel(appVersion), ...(gpuTier ? { gpuTier } : {}) }
}
