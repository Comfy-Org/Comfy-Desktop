import { execFile } from 'child_process'
import fs from 'fs/promises'
import path from 'path'

export interface PcieLinkCaps {
  maxGen: number | null
  slotMaxGen: number | null
}

const POWERSHELL_TIMEOUT_MS = 10_000

export function deviceLookupKey(device: string): string {
  const d = device.trim().toLowerCase()
  if (d.startsWith('\\\\.\\')) return d.slice(4)
  if (d.startsWith('/dev/')) return d.slice(5)
  return d
}

function normalizeGen(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isInteger(n)) return null
  return n >= 1 && n <= 6 ? n : null
}

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
    if (!name.toLowerCase().startsWith('nvme')) continue
    const pciDir = path.join(sysBlockRoot, name, 'device', 'device')
    const maxGen = parseLinkSpeedToGen(await readTrimmed(path.join(pciDir, 'max_link_speed')))
    let slotMaxGen: number | null = null
    try {
      const real = await fs.realpath(pciDir)
      slotMaxGen = parseLinkSpeedToGen(
        await readTrimmed(path.join(path.dirname(real), 'max_link_speed'))
      )
    } catch {}
    if (maxGen === null && slotMaxGen === null) continue
    out.set(name.toLowerCase(), { maxGen, slotMaxGen })
  }
  return out
}

export async function probePcieLinkCaps(): Promise<Map<string, PcieLinkCaps>> {
  try {
    if (process.platform === 'win32') return await probeWindows()
    if (process.platform === 'linux') return await probeLinuxSysfs('/sys/block')
    return new Map()
  } catch {
    return new Map()
  }
}

export const _internal = {
  normalizeGen,
  parseLinkSpeedToGen,
  parseWindowsPcieOutput,
  probeLinuxSysfs
}
