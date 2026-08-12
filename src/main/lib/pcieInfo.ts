/**
 * PCIe link-capability probe for NVMe drives.
 *
 * Answers "what PCIe generation is this drive capable of, and what is the
 * port it sits in capable of?" so telemetry can distinguish a Gen4 drive in
 * a Gen4 slot from a Gen4 drive stuck in a Gen3 slot. We only report the
 * MAX (capability) speeds - the *current* negotiated speed downtrains to
 * 2.5 GT/s at idle on many systems, so a boot-time sample of it would
 * under-report and is deliberately not collected.
 *
 *   Windows: one PowerShell round-trip. Win32_DiskDrive -> parent PnP device
 *            (the NVMe controller, a PCI device) -> DEVPKEY_PciDevice_
 *            MaxLinkSpeed, and the controller's parent (root port) for the
 *            slot capability. Encoded values map directly to generations
 *            (1 = 2.5 GT/s ... 6 = 64 GT/s).
 *   Linux:   sysfs reads, no processes spawned: /sys/block/nvmeXnY/device/
 *            device/max_link_speed (endpoint) and the PCI parent directory's
 *            max_link_speed (port).
 *   macOS:   not probed. IORegistry only exposes the negotiated link, and
 *            Apple silicon internal storage is not on a standard PCIe port;
 *            everything resolves to null.
 *
 * Failure policy: this feeds telemetry only, so nothing here ever throws or
 * rejects - any probe/parse failure yields an empty map or a null field.
 * Results are consumed by `storageInfo.ts`, which caches them inside its
 * once-per-process snapshot.
 *
 * PRIVACY: link generations (small integers 1-6) and event-local disk keys
 * only; no serials, paths, or device identifiers leave this module - map
 * keys are internal join handles for `storageInfo` and are never emitted.
 */
import { execFile } from 'child_process'
import fs from 'fs/promises'
import path from 'path'

export interface PcieLinkCaps {
  /** Max link generation the drive endpoint supports (1-6), null unknown. */
  maxGen: number | null
  /** Max link generation of the port/slot it is attached to (1-6). */
  slotMaxGen: number | null
}

const POWERSHELL_TIMEOUT_MS = 10_000

/**
 * Normalize a physical-device identifier from `si.diskLayout()` to the key
 * shape `probePcieLinkCaps` maps are built with: `\\.\PHYSICALDRIVE0` ->
 * `physicaldrive0`, `/dev/nvme0n1` -> `nvme0n1`.
 */
export function deviceLookupKey(device: string): string {
  const d = device.trim().toLowerCase()
  if (d.startsWith('\\\\.\\')) return d.slice(4)
  if (d.startsWith('/dev/')) return d.slice(5)
  return d
}

/** PCIe Link Capabilities encoded speed -> generation (identity, bounded). */
function normalizeGen(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isInteger(n)) return null
  return n >= 1 && n <= 6 ? n : null
}

/** sysfs link-speed string ("16.0 GT/s PCIe") -> generation. */
function parseLinkSpeedToGen(raw: string | null): number | null {
  if (raw === null) return null
  const m = /^\s*(\d+(?:\.\d+)?)\s*GT\/s/i.exec(raw)
  if (!m) return null
  const gts = Number(m[1])
  if (gts === 2.5) return 1
  if (gts === 5) return 2
  if (gts === 8) return 3
  if (gts === 16) return 4
  if (gts === 32) return 5
  if (gts === 64) return 6
  return null
}

// --- Windows -----------------------------------------------------------------

// `Get-PnpDeviceProperty -KeyName` resolves canonical DEVPKEY names on
// supported builds; the "{guid} pid" form is the documented fallback for
// keys missing from the local name table. DEVPKEY_PciDevice_MaxLinkSpeed is
// {3ab22e31-8264-4b4e-9af5-a8d2d8e33e62} pid 11.
const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
function Get-PropData([string]$id, [string[]]$keys) {
  foreach ($k in $keys) {
    $p = Get-PnpDeviceProperty -InstanceId $id -KeyName $k -ErrorAction SilentlyContinue
    if ($p -and $null -ne $p.Data) { return $p.Data }
  }
  return $null
}
$maxKeys = @('DEVPKEY_PciDevice_MaxLinkSpeed', '{3AB22E31-8264-4B4E-9AF5-A8D2D8E33E62} 11')
$parentKeys = @('DEVPKEY_Device_Parent')
$results = @()
foreach ($d in (Get-CimInstance Win32_DiskDrive)) {
  if ($null -eq $d.Index -or -not $d.PNPDeviceID) { continue }
  $ctrl = Get-PropData $d.PNPDeviceID $parentKeys
  if (-not $ctrl -or $ctrl -notlike 'PCI\\*') { continue }
  $maxGen = Get-PropData $ctrl $maxKeys
  $slotGen = $null
  $port = Get-PropData $ctrl $parentKeys
  if ($port -and $port -like 'PCI\\*') { $slotGen = Get-PropData $port $maxKeys }
  $results += [pscustomobject]@{ index = [int]$d.Index; maxGen = $maxGen; slotMaxGen = $slotGen }
}
ConvertTo-Json -InputObject @($results) -Compress
`

/** Parse the probe script's JSON into a device-key map. Never throws. */
function parseWindowsPcieOutput(stdout: string): Map<string, PcieLinkCaps> {
  const out = new Map<string, PcieLinkCaps>()
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return out
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const { index, maxGen, slotMaxGen } = row as Record<string, unknown>
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) continue
    const caps: PcieLinkCaps = {
      maxGen: normalizeGen(maxGen),
      slotMaxGen: normalizeGen(slotMaxGen)
    }
    if (caps.maxGen === null && caps.slotMaxGen === null) continue
    out.set(`physicaldrive${index}`, caps)
  }
  return out
}

function probeWindows(): Promise<Map<string, PcieLinkCaps>> {
  return new Promise((resolve) => {
    try {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT],
        { timeout: POWERSHELL_TIMEOUT_MS, windowsHide: true },
        (err, stdout) => {
          if (err || !stdout.trim()) return resolve(new Map())
          resolve(parseWindowsPcieOutput(stdout.trim()))
        }
      )
    } catch {
      resolve(new Map())
    }
  })
}

// --- Linux -------------------------------------------------------------------

async function readTrimmed(file: string): Promise<string | null> {
  try {
    return (await fs.readFile(file, 'utf8')).trim()
  } catch {
    return null
  }
}

async function probeLinuxSysfs(sysBlockRoot: string): Promise<Map<string, PcieLinkCaps>> {
  const out = new Map<string, PcieLinkCaps>()
  let entries: string[]
  try {
    entries = await fs.readdir(sysBlockRoot)
  } catch {
    return out
  }
  for (const name of entries) {
    // Only NVMe block devices sit directly on a PCIe endpoint; for SATA the
    // chain leads to the shared AHCI controller, whose link says nothing
    // about the individual drive.
    if (!name.toLowerCase().startsWith('nvme')) continue
    // /sys/block/nvme0n1/device -> nvme0 controller; its `device` link is
    // the PCI endpoint directory (with native NVMe multipath this points at
    // the nvme-subsystem instead and the reads below fail -> skipped).
    const pciDir = path.join(sysBlockRoot, name, 'device', 'device')
    const maxGen = parseLinkSpeedToGen(await readTrimmed(path.join(pciDir, 'max_link_speed')))
    let slotMaxGen: number | null = null
    try {
      // Parent directory of the resolved PCI endpoint is its upstream port.
      // A root-complex-integrated endpoint has no port max_link_speed -> null.
      const real = await fs.realpath(pciDir)
      slotMaxGen = parseLinkSpeedToGen(
        await readTrimmed(path.join(path.dirname(real), 'max_link_speed'))
      )
    } catch {
      // realpath failed (dangling link): no port info, keep the null.
    }
    if (maxGen === null && slotMaxGen === null) continue
    out.set(name.toLowerCase(), { maxGen, slotMaxGen })
  }
  return out
}

// --- Entry point ---------------------------------------------------------------

/**
 * Probe PCIe link capabilities for all NVMe drives. Resolves to a map keyed
 * by `deviceLookupKey`-shaped device names; empty on unsupported platforms
 * or any failure. Never rejects.
 */
export async function probePcieLinkCaps(): Promise<Map<string, PcieLinkCaps>> {
  try {
    if (process.platform === 'win32') return await probeWindows()
    if (process.platform === 'linux') return await probeLinuxSysfs('/sys/block')
    return new Map()
  } catch {
    return new Map()
  }
}

/** @internal - exposed for tests. */
export const _internal = {
  normalizeGen,
  parseLinkSpeedToGen,
  parseWindowsPcieOutput,
  probeLinuxSysfs
}
