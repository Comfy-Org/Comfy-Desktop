import type { ComfyDesktopMachine } from '../../types/comfyDesktopBridge'

type HardwareProbe = () => Promise<{ gpu_vram_gb?: unknown } | null | undefined>

const PROBE_WAIT_MS = 5000

let hardwareProbe: HardwareProbe | null = null

export function setMachineProbe(probe: HardwareProbe | null): void {
  hardwareProbe = probe
}

function platformOf(platform: NodeJS.Platform): ComfyDesktopMachine['platform'] {
  return platform === 'darwin' || platform === 'win32' ? platform : 'linux'
}

async function gpuMemoryGb(): Promise<number | undefined> {
  if (!hardwareProbe) return undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), PROBE_WAIT_MS)
  })
  try {
    const gb = (await Promise.race([hardwareProbe(), timedOut]))?.gpu_vram_gb
    return typeof gb === 'number' && Number.isFinite(gb) && gb > 0 ? gb : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

export async function machine(
  platform: NodeJS.Platform = process.platform
): Promise<ComfyDesktopMachine> {
  const memory = await gpuMemoryGb()
  return {
    platform: platformOf(platform),
    ...(memory === undefined ? {} : { gpuMemoryGb: memory })
  }
}
