/**
 * Storage drive detection for telemetry.
 *
 * Maps filesystem paths (install dir, model dirs, cache, output) to the
 * physical drive they live on and classifies that drive as HDD / SATA SSD /
 * NVMe SSD / etc. Consumed by `ipc/storageTelemetry.ts`, which emits the
 * `comfy.desktop.session.storage_detected` event.
 *
 * Detection joins three `systeminformation` views (each shells out to
 * platform tools: PowerShell WMI/CIM + Get-PhysicalDisk on Windows, lsblk
 * on Linux, diskutil/system_profiler on macOS):
 *
 *   fsSize()       volume list: mount point, fs type, size/free
 *   blockDevices() volume -> physical device link (`device` field)
 *   diskLayout()   physical disks: media type, bus, model, vendor, size
 *
 * The join is best-effort: Storage Spaces / RAID / LVM report as `virtual`,
 * network volumes as `network`, and anything unresolvable as `unknown` -
 * we never guess. Results are snapshotted once per process (the underlying
 * probes spawn child processes) and reused across boots in the same run.
 *
 * PRIVACY: `DriveInfo.driveKey` is an internal grouping handle (it contains
 * device paths like `\\.\PHYSICALDRIVE0`); emitters must map it to anonymous
 * indices and never ship it. Serial numbers, volume UUIDs and labels are
 * never read out of the snapshot at all. Drive model/vendor strings are
 * shared product identifiers (same privacy class as the GPU model we already
 * collect) and are exposed for emission.
 */
import path from 'path'
import si from 'systeminformation'
import type { Systeminformation } from 'systeminformation'

export type StorageClass =
  | 'hdd'
  | 'sata_ssd'
  | 'nvme_ssd'
  | 'other_ssd'
  | 'virtual'
  | 'network'
  | 'unknown'

export type DriveBus =
  | 'nvme'
  | 'pcie'
  | 'sata'
  | 'usb'
  | 'sas_scsi'
  | 'thunderbolt'
  | 'sd'
  | 'virtual'
  | 'network'
  | 'unknown'

export interface DriveInfo {
  storageClass: StorageClass
  bus: DriveBus
  /** USB/Thunderbolt-attached or removable. `null` when undeterminable. */
  external: boolean | null
  removable: boolean | null
  /** Volume filesystem (ntfs / apfs / ext4 / ...). */
  fsType: string | null
  /** Marketing name of the physical disk (e.g. "Samsung SSD 990 PRO 2TB"). */
  driveModel: string | null
  driveVendor: string | null
  /** Physical disk size, GB-rounded (matches `disk_total_gb` precision). */
  driveSizeGb: number | null
  volumeSizeGb: number | null
  volumeFreeGb: number | null
  /**
   * Grouping key: two paths with the same non-null key are on the same
   * physical drive (or at least the same volume when the physical join
   * failed). `null` when the path could not be resolved to any volume.
   * INTERNAL ONLY - contains device paths; never emit it.
   */
  driveKey: string | null
}

interface StorageSnapshot {
  fsSize: Systeminformation.FsSizeData[]
  blockDevices: Systeminformation.BlockDevicesData[]
  diskLayout: Systeminformation.DiskLayoutData[]
}

/**
 * Hard cap on how long we wait for the platform storage probes. On machines
 * with wedged SMB mounts or slow WMI these can stall; storage telemetry is
 * never worth delaying anything for, so past the budget every path resolves
 * `unknown` and the next process run retries.
 */
const SNAPSHOT_TIMEOUT_MS = 15_000

const BYTES_PER_GB = 1_073_741_824

/** Filesystem types that mean "no local physical disk behind this volume". */
const NETWORK_FS_TYPES = new Set([
  'nfs',
  'nfs4',
  'cifs',
  'smb',
  'smb3',
  'smbfs',
  'afpfs',
  'webdav',
  'sshfs',
  'fuse.sshfs',
  '9p',
  'ncpfs'
])

let snapshotPromise: Promise<StorageSnapshot | null> | null = null

async function fetchSnapshot(): Promise<StorageSnapshot | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const probes = Promise.all([si.fsSize(), si.blockDevices(), si.diskLayout()])
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), SNAPSHOT_TIMEOUT_MS)
    })
    const result = await Promise.race([probes, timeout])
    if (!result) return null
    const [fsSize, blockDevices, diskLayout] = result
    return { fsSize, blockDevices, diskLayout }
  } catch {
    return null
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Snapshot the storage topology once per process. A failed probe is not
 * cached so a later boot in the same run can retry.
 */
function getSnapshot(): Promise<StorageSnapshot | null> {
  if (!snapshotPromise) {
    const attempt = fetchSnapshot().then((snap) => {
      if (!snap && snapshotPromise === attempt) snapshotPromise = null
      return snap
    })
    snapshotPromise = attempt
  }
  return snapshotPromise
}

function normalizeBus(raw: string | null | undefined): DriveBus {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === '') return 'unknown'
  if (v.includes('nvme')) return 'nvme'
  if (v.includes('thunderbolt')) return 'thunderbolt'
  if (v.includes('usb')) return 'usb'
  if (
    v.includes('raid') ||
    v.includes('virtual') ||
    v.includes('storage space') ||
    v.includes('file backed')
  ) {
    return 'virtual'
  }
  if (v.includes('pcie') || v.includes('pci-express') || v.startsWith('pci')) return 'pcie'
  // "sata", "ata", "ahci", "serial ata" - but not "atapi" (optical).
  if (v.includes('sata') || v === 'ata' || v.includes('ahci') || v.includes('serial ata')) {
    return 'sata'
  }
  if (v.includes('sas') || v.includes('scsi')) return 'sas_scsi'
  if (v === 'sd' || v.includes('mmc') || v.includes('secure digital')) return 'sd'
  return 'unknown'
}

/** Media type from `diskLayout().type`, normalized across platforms. */
type MediaType = 'hdd' | 'ssd' | 'nvme' | 'virtual' | 'unknown'

function normalizeMedia(raw: string | null | undefined): MediaType {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'nvme') return 'nvme'
  if (v === 'ssd' || v === 'scm') return 'ssd'
  if (v === 'hd' || v === 'hdd') return 'hdd'
  if (v === 'virtual') return 'virtual'
  // macOS reports bare "USB" for some external enclosures - media unknown.
  return 'unknown'
}

function classify(
  volume: Systeminformation.FsSizeData | null,
  bd: Systeminformation.BlockDevicesData | null,
  dl: Systeminformation.DiskLayoutData | null,
  fallbackKey: string | null
): DriveInfo {
  const bus = normalizeBus(dl?.interfaceType || bd?.protocol)
  let media = normalizeMedia(dl?.type)

  // Volume-level media fallback: on Linux/macOS `blockDevices().physical`
  // is the media kind (SSD/HDD). On Windows it is the logical DriveType
  // (Local/Network/...) and must not be used for media.
  if (media === 'unknown' && process.platform !== 'win32') {
    const phys = (bd?.physical ?? '').trim().toLowerCase()
    if (phys === 'ssd') media = 'ssd'
    else if (phys === 'hdd') media = 'hdd'
  }

  let storageClass: StorageClass
  if (bus === 'virtual' || media === 'virtual') {
    storageClass = 'virtual'
  } else if (media === 'nvme' || (media === 'ssd' && (bus === 'nvme' || bus === 'pcie'))) {
    storageClass = 'nvme_ssd'
  } else if (media === 'ssd') {
    storageClass = bus === 'sata' ? 'sata_ssd' : 'other_ssd'
  } else if (media === 'hdd') {
    storageClass = 'hdd'
  } else {
    storageClass = 'unknown'
  }

  const removable = bd ? Boolean(bd.removable) : null
  let external: boolean | null
  if (bus === 'usb' || bus === 'thunderbolt') external = true
  else if (removable === true) external = true
  else if (dl || bd) external = false
  else external = null

  const driveSize = dl && dl.size > 0 ? Math.round(dl.size / BYTES_PER_GB) : null

  return {
    storageClass,
    bus,
    external,
    removable,
    fsType: volume?.type || bd?.fsType || null,
    driveModel: dl?.name?.trim() || null,
    driveVendor: dl?.vendor?.trim() || null,
    driveSizeGb: driveSize,
    volumeSizeGb: volume && volume.size > 0 ? Math.round(volume.size / BYTES_PER_GB) : null,
    volumeFreeGb:
      volume && volume.available >= 0 ? Math.round(volume.available / BYTES_PER_GB) : null,
    driveKey: dl?.device || bd?.device || fallbackKey
  }
}

function networkInfo(volume: Systeminformation.FsSizeData | null, key: string): DriveInfo {
  return {
    storageClass: 'network',
    bus: 'network',
    external: null,
    removable: null,
    fsType: volume?.type || null,
    driveModel: null,
    driveVendor: null,
    driveSizeGb: null,
    volumeSizeGb: volume && volume.size > 0 ? Math.round(volume.size / BYTES_PER_GB) : null,
    volumeFreeGb:
      volume && volume.available >= 0 ? Math.round(volume.available / BYTES_PER_GB) : null,
    driveKey: key
  }
}

const UNRESOLVED: DriveInfo = {
  storageClass: 'unknown',
  bus: 'unknown',
  external: null,
  removable: null,
  fsType: null,
  driveModel: null,
  driveVendor: null,
  driveSizeGb: null,
  volumeSizeGb: null,
  volumeFreeGb: null,
  driveKey: null
}

function resolveWindows(p: string, snap: StorageSnapshot): DriveInfo {
  const resolved = path.win32.resolve(p)
  // UNC share - network, keyed per share root so same-share paths group.
  if (resolved.startsWith('\\\\')) {
    const parts = resolved.slice(2).split('\\')
    const shareRoot = `\\\\${parts.slice(0, 2).join('\\')}`.toLowerCase()
    return networkInfo(null, `net:${shareRoot}`)
  }
  const root = path.win32.parse(resolved).root // "C:\"
  if (!/^[a-z]:[\\/]?$/i.test(root)) return UNRESOLVED
  const letter = root.slice(0, 2).toUpperCase() // "C:"

  const volume =
    snap.fsSize.find((v) => (v.mount || v.fs || '').trim().toUpperCase() === letter) ?? null
  const bd =
    snap.blockDevices.find((d) => (d.mount || d.name || '').trim().toUpperCase() === letter) ?? null
  if (!volume && !bd) return UNRESOLVED

  if ((bd?.physical ?? '').trim().toLowerCase() === 'network') {
    return networkInfo(volume, `net:${letter}`)
  }

  const physDev = (bd?.device ?? '').trim()
  const dl = physDev
    ? (snap.diskLayout.find((d) => d.device?.trim().toLowerCase() === physDev.toLowerCase()) ??
      null)
    : null
  return classify(volume, bd, dl, `vol:${letter}`)
}

/** Longest containing mount point, path-component aware (`/mnt/a` does not
 *  contain `/mnt/ab`). */
function findPosixVolume(
  resolved: string,
  volumes: Systeminformation.FsSizeData[]
): Systeminformation.FsSizeData | null {
  let best: Systeminformation.FsSizeData | null = null
  for (const v of volumes) {
    const mount = (v.mount ?? '').trim()
    if (mount === '') continue
    const contains = mount === '/' ? true : resolved === mount || resolved.startsWith(`${mount}/`)
    if (contains && (!best || mount.length > (best.mount ?? '').length)) best = v
  }
  return best
}

function stripDevPrefix(name: string): string {
  return name.startsWith('/dev/') ? name.slice(5) : name
}

function resolvePosix(p: string, snap: StorageSnapshot): DriveInfo {
  const resolved = path.posix.resolve(p)
  const volume = findPosixVolume(resolved, snap.fsSize)
  if (!volume) return UNRESOLVED

  const fsType = (volume.type ?? '').trim().toLowerCase()
  const fsDev = (volume.fs ?? '').trim()
  if (NETWORK_FS_TYPES.has(fsType) || /^[^/]+:\//.test(fsDev) || fsDev.startsWith('//')) {
    return networkInfo(volume, `net:${volume.mount}`)
  }

  // Volume -> block device: match by mount point first, then by device node
  // name (fsSize reports "/dev/nvme0n1p2", blockDevices reports "nvme0n1p2").
  const devName = stripDevPrefix(fsDev)
  const bd =
    snap.blockDevices.find((d) => (d.mount ?? '') === volume.mount) ??
    snap.blockDevices.find((d) => d.name === devName && devName !== '') ??
    null

  // Block device -> physical disk, normalizing the /dev/ prefix on both sides.
  const parentDev = (bd?.device ?? '').trim()
  const parentName = stripDevPrefix(parentDev)
  const dl = parentName
    ? (snap.diskLayout.find((d) => stripDevPrefix(d.device?.trim() ?? '') === parentName) ?? null)
    : null

  const fallbackKey = `vol:${volume.mount}`
  return classify(volume, bd, dl, fallbackKey)
}

/**
 * Classify each path by the drive it lives on. Returns a map keyed by the
 * input path strings. Never rejects; unresolvable paths map to `unknown`.
 */
export async function classifyPaths(paths: string[]): Promise<Map<string, DriveInfo>> {
  const out = new Map<string, DriveInfo>()
  const snap = await getSnapshot().catch(() => null)
  for (const p of paths) {
    if (out.has(p)) continue
    if (!snap || typeof p !== 'string' || p.trim() === '') {
      out.set(p, UNRESOLVED)
      continue
    }
    try {
      out.set(p, process.platform === 'win32' ? resolveWindows(p, snap) : resolvePosix(p, snap))
    } catch {
      out.set(p, UNRESOLVED)
    }
  }
  return out
}

/** @internal - exposed for tests. */
export function _resetForTest(): void {
  snapshotPromise = null
}
