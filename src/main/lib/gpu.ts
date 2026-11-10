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
  nvidia: 'NVIDIA',
  amd: 'AMD',
  intel: 'Intel',
  mps: 'Apple Silicon'
}

const NVIDIA_VENDOR_ID = '10DE'
const AMD_VENDOR_ID = '1002'
const INTEL_VENDOR_ID = '8086'

function pickGPU(hasNvidia: boolean, hasAmd: boolean, hasIntel: boolean): GpuId | null {
  if (hasNvidia) return 'nvidia'
  if (hasAmd) return 'amd'
  if (hasIntel) return 'intel'
  return null
}

const PS_UTF8_PREFIX = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); '

function runPowershellJson(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_UTF8_PREFIX + command],
      { timeout: 10000, windowsHide: true },
      (err: Error | null, stdout: string) => {
        resolve(err ? null : stdout)
      }
    )
  })
}

async function detectGPU(): Promise<GpuInfo | null> {
  let id: GpuId | null = null
  if (process.platform === 'win32') {
    id = await detectWindowsGPU()
  } else if (process.platform === 'darwin') {
    id = await detectMacGPU()
  } else if (process.platform === 'linux') {
    id = await detectLinuxGPU()
  }
  if (!id) return null
  return { id, label: GPU_LABELS[id], model: null }
}

let cachedGpuPromise: Promise<GpuInfo | null> | null = null

async function detectGPUCached(): Promise<GpuInfo | null> {
  if (!cachedGpuPromise) {
    cachedGpuPromise = detectGPU().catch(() => null)
  }
  const gpu = await cachedGpuPromise
  if (gpu === null) cachedGpuPromise = null
  return gpu
}

async function detectWindowsGPU(): Promise<GpuId | null> {
  const wmiResult = await queryWmiVendorIds()
  if (wmiResult) return wmiResult
  if (await hasNvidiaSmi()) return 'nvidia'
  return null
}

async function queryWmiVendorIds(): Promise<GpuId | null> {
  const stdout = await runPowershellJson(
    'Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty PNPDeviceID | ConvertTo-Json -Compress'
  )
  if (stdout === null) return null
  try {
    const ids: unknown = JSON.parse(stdout)
    const list: unknown[] = Array.isArray(ids) ? ids : [ids]
    let hasNvidia = false,
      hasAmd = false,
      hasIntel = false
    for (const id of list) {
      if (typeof id !== 'string') continue
      const match = id.match(/ven_([0-9a-f]{4})/i)
      if (!match || !match[1]) continue
      const vendor = match[1].toUpperCase()
      if (vendor === NVIDIA_VENDOR_ID) hasNvidia = true
      else if (vendor === AMD_VENDOR_ID) hasAmd = true
      else if (vendor === INTEL_VENDOR_ID) hasIntel = true
    }
    return pickGPU(hasNvidia, hasAmd, hasIntel)
  } catch {
    return null
  }
}

export function parseWmiDriverVersions(stdout: string): Map<string, string> {
  const map = new Map<string, string>()
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return map
  }
  const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const rec = entry as Record<string, unknown>
    const name = rec.Name
    const version = rec.DriverVersion
    if (typeof name === 'string' && typeof version === 'string' && version.trim()) {
      map.set(name.toLowerCase(), version.trim())
    }
  }
  return map
}

export function getWindowsGpuDriverVersions(): Promise<Map<string, string>> {
  if (process.platform !== 'win32') return Promise.resolve(new Map())
  return runPowershellJson(
    'Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion | ConvertTo-Json -Compress'
  ).then((stdout) => (stdout === null ? new Map() : parseWmiDriverVersions(stdout)))
}

function hasNvidiaSmi(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('nvidia-smi', { timeout: 5000, windowsHide: true }, (err: Error | null) => {
      resolve(!err)
    })
  })
}

async function detectLinuxGPU(): Promise<GpuId | null> {
  const lspciResult = await queryLspciVendors()
  if (lspciResult) return lspciResult
  const sysfsResult = querySysfsVendors()
  if (sysfsResult) return sysfsResult
  if (await hasNvidiaSmi()) return 'nvidia'
  return null
}

function queryLspciVendors(): Promise<GpuId | null> {
  return new Promise((resolve) => {
    execFile('lspci', ['-nn'], { timeout: 5000 }, (err: Error | null, stdout: string) => {
      if (err) return resolve(null)
      let hasNvidia = false,
        hasAmd = false,
        hasIntel = false
      for (const line of stdout.split('\n')) {
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
    const cards = fs.readdirSync('/sys/class/drm').filter((d) => /^card\d+$/.test(d))
    let hasNvidia = false,
      hasAmd = false,
      hasIntel = false
    for (const card of cards) {
      try {
        const vendor = fs
          .readFileSync(`/sys/class/drm/${card}/device/vendor`, 'utf-8')
          .trim()
          .replace(/^0x/i, '')
          .toUpperCase()
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
    execFile(
      'sysctl',
      ['-n', 'machdep.cpu.brand_string'],
      { timeout: 5000 },
      (err: Error | null, stdout: string) => {
        if (err) return resolve(null)
        resolve(stdout.toLowerCase().includes('apple') ? 'mps' : null)
      }
    )
  })
}

const NVIDIA_DRIVER_MIN_VERSION = '580'

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na - nb
  }
  return 0
}

export function parseNvidiaDriverVersion(output: string): string | undefined {
  const match = output.match(/driver version\s*:\s*([\d.]+)/i)
  return match?.[1]
}

function getNvidiaDriverVersionQuery(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=driver_version', '--format=csv,noheader'],
      { timeout: 5000, windowsHide: true },
      (err: Error | null, stdout: string) => {
        if (err) return resolve(undefined)
        const version = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find(Boolean)
        resolve(version || undefined)
      }
    )
  })
}

function getNvidiaDriverVersionFallback(): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      { timeout: 5000, windowsHide: true },
      (err: Error | null, stdout: string) => {
        if (err) return resolve(undefined)
        resolve(parseNvidiaDriverVersion(stdout))
      }
    )
  })
}

const NVIDIA_DRIVER_VERSION_SHAPE = /^\d+(\.\d+)*$/

export function sanitizeNvidiaDriverVersion(version: string | undefined): string | undefined {
  return version && NVIDIA_DRIVER_VERSION_SHAPE.test(version) ? version : undefined
}

export async function detectNvidiaDriverVersion(): Promise<string | undefined> {
  return sanitizeNvidiaDriverVersion(
    (await getNvidiaDriverVersionQuery()) ?? (await getNvidiaDriverVersionFallback())
  )
}

async function checkNvidiaDriver(): Promise<NvidiaDriverCheck | null> {
  if (process.platform === 'darwin') return null

  const driverVersion = await detectNvidiaDriverVersion()
  if (!driverVersion) return null

  return {
    driverVersion,
    minimumVersion: NVIDIA_DRIVER_MIN_VERSION,
    supported: compareVersions(driverVersion, NVIDIA_DRIVER_MIN_VERSION) >= 0
  }
}

export interface SystemGpuEntry {
  vendor: string
  model: string
  vram_mb: number | null
  driver_version: string | null
}

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

export function isVirtualGpu(model: string | null | undefined): boolean {
  if (!model) return false
  return VIRTUAL_GPU_PATTERNS.some((re) => re.test(model))
}

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

export function parseAmdSmiDriverVersion(stdout: string): string | undefined {
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
      const driver = findValue(rec, /^driver$/i)
      if (driver && typeof driver === 'object') {
        const version = findValue(driver as Record<string, unknown>, /version/i)
        if (typeof version === 'string' && version.trim()) return version.trim()
      }
      const flat = findValue(rec, /driver.?version/i)
      if (typeof flat === 'string' && flat.trim()) return flat.trim()
    }
  } catch {}
  return undefined
}

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
  } catch {}
  return undefined
}

function tryExecFile(file: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: 5000, windowsHide: true },
      (err: Error | null, stdout: string) => {
        resolve(err ? undefined : stdout)
      }
    )
  })
}

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

async function checkAmdDriver(): Promise<string | undefined> {
  return getAmdDriverVersionLinux()
}

const KFD_PATH = '/dev/kfd'

export async function checkLinuxAmdKfdAccess(kfdPath = KFD_PATH): Promise<string | null> {
  if (process.platform !== 'linux') return null
  if (!fs.existsSync(kfdPath)) {
    return (
      `No AMD GPU compute interface was found (${kfdPath} does not exist). ` +
      'The amdgpu kernel driver may not be loaded; ComfyUI will not be able to use the GPU until it is.'
    )
  }
  try {
    await fs.promises.access(kfdPath, fs.constants.R_OK | fs.constants.W_OK)
    return null
  } catch {
    return (
      `Your user cannot access the AMD GPU compute interface (${kfdPath}), so ComfyUI will not be able to use the GPU. ` +
      'This usually means your user is not in the "render" group. ' +
      'Run "sudo usermod -aG render $USER", then log out and back in, and try again.'
    )
  }
}

async function validateHardware(): Promise<HardwareValidation> {
  if (process.platform === 'darwin') {
    const gpu = await detectMacGPU()
    if (!gpu) {
      return {
        supported: false,
        error: 'ComfyUI requires Apple Silicon (M1/M2/M3) Mac. Intel-based Macs are not supported.'
      }
    }
  }
  if (process.platform === 'linux') {
    const gpu = await detectGPU()
    if (gpu?.id === 'amd') {
      const warning = await checkLinuxAmdKfdAccess()
      if (warning) return { supported: true, warning }
    }
  }
  return { supported: true }
}

export { detectGPU, detectGPUCached, checkNvidiaDriver, checkAmdDriver, validateHardware }
