/**
 * The client context Desktop hands the local comfy-agent at ComfyUI launch: the app
 * channel and the machine's GPU tier, which the agent sends with its OS and arch on a
 * turn's cloud model calls. Only with Desktop telemetry consent; see buildLaunchEnv.
 */
import type { GpuTier } from '../../shared/gpuTier'
import { deriveAppChannel } from './telemetry'

/** Env names the agent reads (cloud services/agent/local/config). */
export const AGENT_CLIENT_ENV_VARS = [
  'AGENT_CLIENT_CONTEXT',
  'AGENT_CLIENT_CHANNEL',
  'AGENT_CLIENT_GPU_TIER'
] as const

export interface AgentClientContext {
  channel: string
  gpuTier?: GpuTier
}

/** A launch never waits longer than this on the hardware probe (nvidia-smi, WMI). */
const GPU_TIER_WAIT_MS = 2000

type HardwareProbe = () => Promise<{ gpu_tier?: unknown }>
let hardwareProbe: HardwareProbe | null = null

/** registerAppHandlers shares its memoized probe, so launch and get-system-info run it once. */
export function setHardwareProbe(probe: HardwareProbe | null): void {
  hardwareProbe = probe
}

async function gpuTierWithin(ms: number): Promise<GpuTier | undefined> {
  if (!hardwareProbe) return undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms)
  })
  try {
    const tier = await Promise.race([
      hardwareProbe().then((h) => h.gpu_tier as GpuTier | undefined),
      timeout
    ])
    return tier || undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** The context for this launch, or undefined without telemetry consent. */
export async function agentClientContext(
  telemetryGranted: boolean,
  appVersion: string,
  waitMs = GPU_TIER_WAIT_MS
): Promise<AgentClientContext | undefined> {
  if (!telemetryGranted) return undefined
  const gpuTier = await gpuTierWithin(waitMs)
  return { channel: deriveAppChannel(appVersion), ...(gpuTier ? { gpuTier } : {}) }
}
