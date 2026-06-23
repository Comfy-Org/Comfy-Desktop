import { execFile } from 'child_process'
import fs from 'fs'
import type { HardwareValidation, NvidiaDriverCheck } from '../../types/ipc'

type GpuId = 'nvidia' | 'amd' | 'intel' | 'mps'

export interface GpuInfo {
  id: GpuId
  label: string
  model: string | null
}

const GPU_LABELS: Record<GpuId, string> = {
  nvidia: "NVIDIA",
  amd: "AMD",
  intel: "Intel",
  mps: "Apple Silicon",
}

const NVIDIA_VENDOR_ID = "10DE"
const AMD_VENDOR_ID = "1002"
const INTEL_VENDOR_ID = "8086"

function pickGPU(hasNvidia: boolean, hasAmd: boolean, hasIntel: boolean): GpuId | null {
  if (hasNvidia) return "nvidia"
  if (hasAmd) return "amd"
  if (hasIntel) return "intel"
  return null
}

/**
 * Detect GPU type, or null if no supported GPU is found.
 *   Windows: WMI vendor IDs, then nvidia-smi.
 *   Linux/WSL: lspci, then /sys/class/drm, then nvidia-smi.
 *   macOS: "mps" for Apple Silicon, null for Intel.
 */
async function detectGPU(): Promise<GpuInfo | null> {
  let id: GpuId | null = null
  if (process.platform === "win32") {
    id = await detectWindowsGPU()
  } else if (process.platform === "darwin") {
    id = await detectMacGPU()
  } else if (process.platform === "linux") {
    id = await detectLinuxGPU()
  }
  if (!id) return null
  return { id, label: GPU_LABELS[id], model: null }
}

async function detectWindowsGPU(): Promise<GpuId | null> {
  const wmiResult = await queryWmiVendorIds()
  if (wmiResult) return wmiResult
  if (await hasNvidiaSmi()) return "nvidia"
  return null
}

function queryWmiVendorIds(): Promise<GpuId | null> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command",
        '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty PNPDeviceID | ConvertTo-Json -Compress'],
      { timeout: 10000, windowsHide: true },
      (err: Error | null, stdout: string) => {
        if (err) return resolve(null)
        try {
          const ids: unknown = JSON.parse(stdout)
          const list: unknown[] = Array.isArray(ids) ? ids : [ids]
          let hasNvidia = false, hasAmd = false, hasIntel = false
          for (const id of list) {
            if (typeof id !== "string") continue
            const match = id.match(/ven_([0-9a-f]{4})/i)
            if (!match || !match[1]) continue
            const vendor = match[1].toUpperCase()
            if (vendor === NVIDIA_VENDOR_ID) hasNvidia = true
            else if (vendor === AMD_VENDOR_ID) hasAmd = true
            else if (vendor === INTEL_VENDOR_ID) hasIntel = true
          }
          resolve(pickGPU(hasNvidia, hasAmd, hasIntel))
        } catch {
          resolve(null)
        }
      },
    )
  })
}

function hasNvidiaSmi(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("nvidia-smi", { timeout: 5000, windowsHide: true }, (err: Error | null) => {
      resolve(!err)
    })
  })
}

async function detectLinuxGPU(): Promise<GpuId | null> {
  const lspciResult = await queryLspciVendors()
  if (lspciResult) return lspciResult
  const sysfsResult = querySysfsVendors()
  if (sysfsResult) return sysfsResult
  if (await hasNvidiaSmi()) return "nvidia"
  return null
}

function queryLspciVendors(): Promise<GpuId | null> {
  return new Promise((resolve) => {
    execFile("lspci", ["-nn"], { timeout: 5000 }, (err: Error | null, stdout: string) => {
      if (err) return resolve(null)
      let hasNvidia = false, hasAmd = false, hasIntel = false
      for (const line of stdout.split("\n")) {
        if (!/vga|3d|display/i.test(line)) continue
        const match = line.match(/\[([0-9a-f]{4}):[0-9a-f]{4}\]/i)
        if (!match || !match[1]) continue
        const vendor = match[1].toUpperCase()
        if (vendor === NVIDIA_VENDOR_ID) hasNvidia = true
        else if (vendor === AMD_VENDOR_ID) hasAmd = true
        else if (vendor === INTEL_VENDOR_ID) hasIntel = true
      }
      resolve(pickGPU(hasNvidia, hasAmd, hasIntel))
    })
  })
}

function querySysfsVendors(): GpuId | null {
  try {
    const cards = fs.readdirSync("/sys/class/drm").filter((d) => /^card\d+$/.test(d))
    let hasNvidia = false, hasAmd = false, hasIntel = false
    for (const card of cards) {
      try {
        const vendor = fs.readFileSync(`/sys/class/drm/${card}/device/vendor`, "utf-8").trim().replace(/^0x/i, "").toUpperCase()
        if (vendor === NVIDIA_VENDOR_ID) hasNvidia = true
        else if (vendor === AMD_VENDOR_ID) hasAmd = true
        else if (vendor === INTEL_VENDOR_ID) hasIntel = true
      } catch {}
    }
    return pickGPU(hasNvidia, hasAmd, hasIntel)
  } catch {}
  return null
}

async function detectMacGPU(): Promise<GpuId | null> {
  return new Promise((resolve) => {
    execFile("sysctl", ["-n", "machdep.cpu.brand_string"], { timeout: 5000 }, (err: Error | null, stdout: string) => {
      if (err) return resolve(null)
      resolve(stdout.toLowerCase().includes("apple") ? "mps" : null)
    })
  })
}

/** Minimum NVIDIA driver for PyTorch 2.10 / CUDA 13.0 (cu130); matches desktop's value. */
const NVIDIA_DRIVER_MIN_VERSION = "580"

/** Compare dotted version strings numerically: negative if a<b, positive if a>b, 0 if equal. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return 0
}

/** Parse "Driver Version: XXX.XX" from nvidia-smi standard output. */
export function parseNvidiaDriverVersion(output: string): string | undefined {
  const match = output.match(/driver version\s*:\s*([\d.]+)/i)
  return match?.[1]
}

/** Query nvidia-smi for the driver version using the structured CSV flag. */
function getNvidiaDriverVersionQuery(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=driver_version", "--format=csv,noheader"],
      { timeout: 5000, windowsHide: true },
      (err: Error | null, stdout: string) => {
        if (err) return resolve(undefined)
        const version = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean)
        resolve(version || undefined)
      },
    )
  })
}

/** Fallback: parse driver version from plain nvidia-smi output. */
function getNvidiaDriverVersionFallback(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      { timeout: 5000, windowsHide: true },
      (err: Error | null, stdout: string) => {
        if (err) return resolve(undefined)
        resolve(parseNvidiaDriverVersion(stdout))
      },
    )
  })
}

/** Check whether the installed NVIDIA driver meets the minimum version; null if none detected. */
async function checkNvidiaDriver(): Promise<NvidiaDriverCheck | null> {
  if (process.platform === "darwin") return null

  const driverVersion =
    (await getNvidiaDriverVersionQuery()) ?? (await getNvidiaDriverVersionFallback())
  if (!driverVersion) return null

  return {
    driverVersion,
    minimumVersion: NVIDIA_DRIVER_MIN_VERSION,
    supported: compareVersions(driverVersion, NVIDIA_DRIVER_MIN_VERSION) >= 0,
  }
}

/** GPU controller entry as collected from `systeminformation`'s `controllers[]`. */
export interface SystemGpuEntry {
  vendor: string
  model: string
  vram_mb: number | null
  driver_version: string | null
}

/**
 * Display adapters that are not real compute GPUs: virtual monitors,
 * remote-display drivers, hypervisor framebuffers. On Windows
 * `Win32_VideoController` enumerates these alongside the real GPU and the
 * ordering is not guaranteed, so `controllers[0]` is frequently one of these.
 * Virtual display adapters are excluded from primary selection. Matched
 * case-insensitively against the controller model name.
 */
const VIRTUAL_GPU_PATTERNS: RegExp[] = [
  /microsoft basic render/i,
  /microsoft basic display/i,
  /microsoft remote display/i,
  /remote desktop/i,
  /\brdp\b/i,
  /parsec/i,
  /vmware/i,
  /virtualbox/i,
  /hyper-?v/i,
  /virtio/i,
  /\bqxl\b/i,
  /bochs/i,
  /llvmpipe/i,
  /softpipe/i,
  /citrix/i,
  /indirect display/i,
  /spacedesk/i,
  /virtual monitor/i,
  /\bidd\b/i
]

/** True if the controller model looks like a virtual / remote display adapter. */
export function isVirtualGpu(model: string | null | undefined): boolean {
  if (!model) return false
  return VIRTUAL_GPU_PATTERNS.some((re) => re.test(model))
}

/**
 * Map a detected `GpuId` to a matcher against systeminformation's free-form
 * vendor/model strings. Both are checked because some controllers report an
 * empty vendor but carry the brand in the model name (e.g. `NVIDIA GeForce …`).
 */
export function vendorMatches(id: GpuId, ...parts: (string | null | undefined)[]): boolean {
  const v = parts.filter(Boolean).join(' ').toLowerCase()
  switch (id) {
    case 'nvidia':
      return v.includes('nvidia')
    case 'amd':
      return (
        v.includes('amd') ||
        v.includes('advanced micro') ||
        v.includes('ati') ||
        v.includes('radeon')
      )
    case 'intel':
      return v.includes('intel')
    case 'mps':
      return v.includes('apple')
  }
}

/**
 * Choose the real compute GPU from the systeminformation controller list.
 *
 * `controllers[0]` is unreliable: on Windows the list includes virtual
 * display adapters in no guaranteed order. We instead drop virtual adapters,
 * prefer the controller whose vendor matches the PCI-derived `detectGPU()`
 * result, and break ties on VRAM. Falls back to the highest-VRAM non-virtual
 * controller, then to the first entry, so we always return something when any
 * controller exists. The caller keeps the full unfiltered array for
 * retroactive analysis; this only picks the promoted "primary".
 */
export function selectPrimaryGpu(
  gpus: SystemGpuEntry[],
  detectedVendor: GpuId | null
): SystemGpuEntry | null {
  if (gpus.length === 0) return null
  const real = gpus.filter((g) => !isVirtualGpu(g.model))
  const pool = real.length > 0 ? real : gpus
  const byVramDesc = (a: SystemGpuEntry, b: SystemGpuEntry): number =>
    (b.vram_mb ?? 0) - (a.vram_mb ?? 0)
  if (detectedVendor) {
    const matching = pool.filter((g) => vendorMatches(detectedVendor, g.vendor, g.model))
    if (matching.length > 0) return [...matching].sort(byVramDesc)[0]!
  }
  return [...pool].sort(byVramDesc)[0]!
}

/**
 * Parse the AMDGPU/ROCm driver version from `amd-smi static --driver --json`.
 *
 * Output is an array of per-GPU objects, each with a `driver` field carrying
 * `{ name, version }` (key casing varies across releases). Returns the first
 * non-empty version, or undefined.
 */
export function parseAmdSmiDriverVersion(stdout: string): string | undefined {
  /** Case-insensitively read the first object value whose key matches `re`. */
  const findValue = (obj: Record<string, unknown>, re: RegExp): unknown => {
    for (const [key, value] of Object.entries(obj)) {
      if (re.test(key)) return value
    }
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(stdout)
    const entries: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue
      const rec = entry as Record<string, unknown>
      // Preferred shape: { driver: { name, version } } (key casing varies).
      const driver = findValue(rec, /^driver$/i)
      if (driver && typeof driver === 'object') {
        const version = findValue(driver as Record<string, unknown>, /version/i)
        if (typeof version === 'string' && version.trim()) return version.trim()
      }
      // Flat fallback: { driver_version / DRIVER_VERSION: "..." }.
      const flat = findValue(rec, /driver.?version/i)
      if (typeof flat === 'string' && flat.trim()) return flat.trim()
    }
  } catch {
    // not JSON / unexpected shape
  }
  return undefined
}

/**
 * Parse the kernel-module/ROCm version from `rocm-smi --showdriverversion --json`.
 *
 * Output is keyed by scope, e.g. `{ "system": { "Driver version": "6.8.5" } }`
 * (older builds key per-card). Returns the first `Driver version` value found.
 */
export function parseRocmSmiDriverVersion(stdout: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (!parsed || typeof parsed !== 'object') return undefined
    for (const scope of Object.values(parsed as Record<string, unknown>)) {
      if (!scope || typeof scope !== 'object') continue
      for (const [key, value] of Object.entries(scope as Record<string, unknown>)) {
        if (/driver version/i.test(key) && typeof value === 'string' && value.trim()) {
          return value.trim()
        }
      }
    }
  } catch {
    // not JSON / unexpected shape
  }
  return undefined
}

/** Run a candidate command, resolving its stdout or undefined on any failure. */
function tryExecFile(file: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: 5000, windowsHide: true }, (err: Error | null, stdout: string) => {
      resolve(err ? undefined : stdout)
    })
  })
}

/**
 * AMD GPU driver/runtime version on Linux via ROCm tooling.
 *
 * Tries `amd-smi` (current tool) then `rocm-smi` (legacy). Both exist only
 * when ROCm is installed and may live under `/opt/rocm/bin` rather than on
 * PATH, so each is probed at its bare name and the rocm path. Returns the
 * AMDGPU module / ROCm version, or undefined. Windows AMD driver comes from
 * the systeminformation controller `driver_version` instead (no rocm-smi
 * there).
 */
async function getAmdDriverVersionLinux(): Promise<string | undefined> {
  if (process.platform !== 'linux') return undefined
  const amdSmi = ['amd-smi', '/opt/rocm/bin/amd-smi']
  for (const bin of amdSmi) {
    const out = await tryExecFile(bin, ['static', '--driver', '--json'])
    const version = out && parseAmdSmiDriverVersion(out)
    if (version) return version
  }
  const rocmSmi = ['rocm-smi', '/opt/rocm/bin/rocm-smi']
  for (const bin of rocmSmi) {
    const out = await tryExecFile(bin, ['--showdriverversion', '--json'])
    const version = out && parseRocmSmiDriverVersion(out)
    if (version) return version
  }
  return undefined
}

/**
 * Resolve the AMD driver version. Prefers the Linux ROCm tooling (which
 * reports the compute-relevant AMDGPU/ROCm version); on Windows there is no
 * such tool, so callers fall back to the selected controller's
 * `driver_version`. Returns undefined when nothing is detected.
 */
async function checkAmdDriver(): Promise<string | undefined> {
  return getAmdDriverVersionLinux()
}

/** Validate hardware for standalone install. Rejects Intel Macs (MPS needs Apple Silicon). */
async function validateHardware(): Promise<HardwareValidation> {
  if (process.platform === "darwin") {
    const gpu = await detectMacGPU()
    if (!gpu) {
      return {
        supported: false,
        error: "ComfyUI requires Apple Silicon (M1/M2/M3) Mac. Intel-based Macs are not supported.",
      }
    }
  }
  return { supported: true }
}

export { detectGPU, checkNvidiaDriver, checkAmdDriver, validateHardware }
