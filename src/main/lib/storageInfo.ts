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
 * collect); because they are free-form OS strings they are validated by
 * `sanitizeHardwareLabel` (fail-closed: path/device/UUID/serial-ish shapes
 * become null) before they land in `DriveInfo`. `fsType` is reduced to a
 * closed allowlist so a malformed OS value can never smuggle arbitrary text.
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
  /** Volume filesystem, reduced to a known allowlist (`other` otherwise). */
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
 * Hard cap on how long a caller waits for the platform storage probes. On
 * machines with wedged SMB mounts or slow WMI these can stall; storage
 * telemetry is never worth delaying anything for, so past the budget every
 * path resolves `unknown` for THIS caller. The underlying probes cannot be
 * cancelled, so they keep running and their (late) result is cached for the
 * next boot instead of spawning a fresh probe set on top of a stuck one.
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
  'davfs',
  'sshfs',
  'fuse.sshfs',
  'fuse.rclone',
  'rclone',
  'fuse.cephfs',
  'ceph',
  'glusterfs',
  'fuse.glusterfs',
  '9p',
  'ncpfs'
])

/** One raw probe at a time; a timed-out caller must not stack another. */
let inflightProbe: Promise<StorageSnapshot | null> | null = null
/** Last successful probe result; reused for the rest of the process. */
let cachedSnapshot: StorageSnapshot | null = null

async function fetchSnapshot(): Promise<StorageSnapshot | null> {
  try {
    const [fsSize, blockDevices, diskLayout] = await Promise.all([
      si.fsSize(),
      si.blockDevices(),
      si.diskLayout()
    ])
    return { fsSize, blockDevices, diskLayout }
  } catch {
    return null
  }
}

/**
 * Snapshot the storage topology once per process. A successful probe is
 * cached forever (even when it lands after a caller's timeout); a failed
 * probe is not, so a later boot in the same run retries. Each caller's wait
 * is bounded by `SNAPSHOT_TIMEOUT_MS` without cancelling the shared probe.
 */
function getSnapshot(): Promise<StorageSnapshot | null> {
  if (cachedSnapshot) return Promise.resolve(cachedSnapshot)
  if (!inflightProbe) {
    inflightProbe = fetchSnapshot().then((snap) => {
      inflightProbe = null
      if (snap) cachedSnapshot = snap
      return snap
    })
  }
  const probe = inflightProbe
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), SNAPSHOT_TIMEOUT_MS)
    void probe.then((snap) => {
      clearTimeout(timer)
      resolve(snap)
    })
  })
}

/**
 * Fail-closed validator for free-form hardware identity strings (disk
 * model/vendor). These are the only OS-originated free text we ship, so a
 * malformed or hostile value must never smuggle a path, device node, UUID,
 * or other prohibited identifier into telemetry. Anything that does not look
 * like a plain product label becomes `null`.
 */
function sanitizeHardwareLabel(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  if (v === '' || v.length > 64) return null
  // Plain label characters only: letters/digits/underscore, space and a few
  // common product-name separators. This rejects path separators (`/`, `\`),
  // device shapes (`\\.\PHYSICALDRIVE0`, `/dev/nvme0n1`), braces/GUID wrappers
  // (`Volume{...}`), colons, and all control characters.
  if (!/^[\w .\-+(),[\]]+$/.test(v)) return null
  // Reject UUID/GUID-shaped values even without braces.
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(v)) return null
  // Must contain at least one letter (a bare digit string is meaningless as
  // a model and could be a serial).
  if (!/[a-z]/i.test(v)) return null
  return v
}

/**
 * Volume filesystems we report by name; anything else becomes `other` so a
 * malformed OS value can never carry arbitrary text into telemetry.
 */
const KNOWN_FS_TYPES = new Set([
  'ntfs',
  'refs',
  'exfat',
  'fat32',
  'fat',
  'vfat',
  'apfs',
  'hfs',
  'hfs+',
  'hfsplus',
  'ext2',
  'ext3',
  'ext4',
  'btrfs',
  'xfs',
  'zfs',
  'f2fs',
  'bcachefs',
  'fuseblk',
  'nfs',
  'nfs4',
  'cifs',
  'smb',
  'smbfs'
])

function normalizeFsType(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === '') return null
  return KNOWN_FS_TYPES.has(v) ? v : 'other'
}

function normalizeBus(raw: string | null | undefined): DriveBus {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === '') return 'unknown'
  if (v.includes('nvme')) return 'nvme'
  if (v.includes('thunderbolt')) return 'thunderbolt'
  if (v.includes('usb')) return 'usb'
  if (isVirtualHint(v)) return 'virtual'
  if (v.includes('pcie') || v.includes('pci-express') || v.startsWith('pci')) return 'pcie'
  // "sata", "ata", "ahci", "serial ata" - but not "atapi" (optical).
  if (v.includes('sata') || v === 'ata' || v.includes('ahci') || v.includes('serial ata')) {
    return 'sata'
  }
  if (v.includes('sas') || v.includes('scsi')) return 'sas_scsi'
  if (v === 'sd' || v.includes('mmc') || v.includes('secure digital')) return 'sd'
  return 'unknown'
}

/**
 * Virtual-topology hints across all the fields the OSes surface them in:
 * Windows `Get-PhysicalDisk` bus `"Spaces"` / friendly `"Storage Space"`,
 * lsblk device types `lvm` / `raid0..raid10` / `dm` / `md`, macOS APFS
 * `"virtual"` rows, and hypervisor "Virtual Disk" models.
 */
function isVirtualHint(raw: string | null | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === '') return false
  return (
    v.includes('virtual') ||
    v.includes('raid') ||
    v === 'lvm' ||
    v === 'dm' ||
    v === 'md' ||
    v === 'spaces' ||
    v.includes('storage space') ||
    v.includes('file backed')
  )
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

  // Virtual topology can surface in fields other than the media/bus we
  // normalized: lsblk block-device type (lvm / raid1 / ...), Windows
  // Get-PhysicalDisk bus "Spaces", macOS APFS "virtual" rows.
  const virtual =
    bus === 'virtual' ||
    media === 'virtual' ||
    isVirtualHint(bd?.type) ||
    isVirtualHint(dl?.type) ||
    isVirtualHint(dl?.interfaceType)

  // Volume-level media fallback: on Linux/macOS `blockDevices().physical`
  // is the media kind (SSD/HDD). On Windows it is the logical DriveType
  // (Local/Network/...) and must not be used for media.
  if (media === 'unknown' && !virtual && process.platform !== 'win32') {
    const phys = (bd?.physical ?? '').trim().toLowerCase()
    if (phys === 'ssd') media = 'ssd'
    else if (phys === 'hdd') media = 'hdd'
  }

  let storageClass: StorageClass
  if (virtual) {
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
    fsType: normalizeFsType(volume?.type || bd?.fsType),
    driveModel: sanitizeHardwareLabel(dl?.name),
    driveVendor: sanitizeHardwareLabel(dl?.vendor),
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
    fsType: normalizeFsType(volume?.type),
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
  let resolved = path.win32.resolve(p)
  // Strip the extended-length prefix so \\?\C:\... resolves as a local path
  // and \\?\UNC\server\share\... as a normal UNC path.
  if (resolved.startsWith('\\\\?\\UNC\\')) resolved = `\\\\${resolved.slice(8)}`
  else if (resolved.startsWith('\\\\?\\')) resolved = resolved.slice(4)
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
  let bestLen = -1
  for (const v of volumes) {
    // Normalize away trailing slashes (but keep root "/") so a mount
    // reported as "/mnt/models/" still matches "/mnt/models/checkpoints".
    let mount = (v.mount ?? '').trim()
    if (mount.length > 1) mount = mount.replace(/\/+$/, '')
    if (mount === '') continue
    const contains = mount === '/' ? true : resolved === mount || resolved.startsWith(`${mount}/`)
    if (contains && mount.length > bestLen) {
      best = v
      bestLen = mount.length
    }
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
  // Network sources: known remote fs types, "host:/export" (NFS),
  // "remote:" / "remote:path" (rclone-style), and "//server/share" (CIFS).
  // A colon in a non-path source is always a remote of some kind - local
  // devices are /dev/... nodes or bare names (tmpfs, overlay).
  if (NETWORK_FS_TYPES.has(fsType) || /^[^/\\]+:/.test(fsDev) || fsDev.startsWith('//')) {
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
  inflightProbe = null
  cachedSnapshot = null
}
