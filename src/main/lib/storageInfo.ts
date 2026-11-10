import path from 'path'
import si from 'systeminformation'
import type { Systeminformation } from 'systeminformation'
import { probePcieLinkCaps, deviceLookupKey, type PcieLinkCaps } from './pcieInfo'

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
  external: boolean | null
  removable: boolean | null
  fsType: string | null
  driveModel: string | null
  driveVendor: string | null
  driveSizeGb: number | null
  volumeSizeGb: number | null
  volumeFreeGb: number | null
  pcieMaxGen: number | null
  pcieSlotMaxGen: number | null
  driveKey: string | null
}

interface StorageSnapshot {
  fsSize: Systeminformation.FsSizeData[]
  blockDevices: Systeminformation.BlockDevicesData[]
  diskLayout: Systeminformation.DiskLayoutData[]
  pcie: Map<string, PcieLinkCaps>
}

const SNAPSHOT_TIMEOUT_MS = 15_000

const BYTES_PER_GB = 1_073_741_824

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

let inflightProbe: Promise<StorageSnapshot | null> | null = null
let cachedSnapshot: StorageSnapshot | null = null

async function fetchSnapshot(): Promise<StorageSnapshot | null> {
  try {
    const [fsSize, blockDevices, diskLayout, pcie] = await Promise.all([
      si.fsSize(),
      si.blockDevices(),
      si.diskLayout(),
      probePcieLinkCaps().catch(() => new Map<string, PcieLinkCaps>())
    ])
    return { fsSize, blockDevices, diskLayout, pcie }
  } catch {
    return null
  }
}

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

function sanitizeHardwareLabel(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  if (v === '' || v.length > 64) return null
  if (!/^[\w .\-+(),[\]]+$/.test(v)) return null
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(v)) return null
  if (!/[a-z]/i.test(v)) return null
  return v
}

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
  'smbfs',
  'webdav'
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
  if (v.includes('sata') || v === 'ata' || v.includes('ahci') || v.includes('serial ata')) {
    return 'sata'
  }
  if (v.includes('sas') || v.includes('scsi')) return 'sas_scsi'
  if (v === 'sd' || v.includes('mmc') || v.includes('secure digital')) return 'sd'
  return 'unknown'
}

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

type MediaType = 'hdd' | 'ssd' | 'nvme' | 'virtual' | 'unknown'

function normalizeMedia(raw: string | null | undefined): MediaType {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'nvme') return 'nvme'
  if (v === 'ssd' || v === 'scm') return 'ssd'
  if (v === 'hd' || v === 'hdd') return 'hdd'
  if (v === 'virtual') return 'virtual'
  return 'unknown'
}

function classify(
  volume: Systeminformation.FsSizeData | null,
  bd: Systeminformation.BlockDevicesData | null,
  dl: Systeminformation.DiskLayoutData | null,
  fallbackKey: string | null,
  pcie: Map<string, PcieLinkCaps>
): DriveInfo {
  const bus = normalizeBus(dl?.interfaceType || bd?.protocol)
  let media = normalizeMedia(dl?.type)

  const virtual =
    bus === 'virtual' ||
    media === 'virtual' ||
    isVirtualHint(bd?.type) ||
    isVirtualHint(dl?.type) ||
    isVirtualHint(dl?.interfaceType)

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

  let pcieCaps: PcieLinkCaps | undefined
  if (!virtual && (bus === 'nvme' || bus === 'pcie') && dl?.device) {
    pcieCaps = pcie.get(deviceLookupKey(dl.device))
  }

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
    pcieMaxGen: pcieCaps?.maxGen ?? null,
    pcieSlotMaxGen: pcieCaps?.slotMaxGen ?? null,
    driveKey: dl?.device || bd?.device || fallbackKey
  }
}

function networkInfo(
  volume: Systeminformation.FsSizeData | null,
  key: string,
  fsType: string | null = normalizeFsType(volume?.type)
): DriveInfo {
  return {
    storageClass: 'network',
    bus: 'network',
    external: null,
    removable: null,
    fsType,
    driveModel: null,
    driveVendor: null,
    driveSizeGb: null,
    volumeSizeGb: volume && volume.size > 0 ? Math.round(volume.size / BYTES_PER_GB) : null,
    volumeFreeGb:
      volume && volume.available >= 0 ? Math.round(volume.available / BYTES_PER_GB) : null,
    pcieMaxGen: null,
    pcieSlotMaxGen: null,
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
  pcieMaxGen: null,
  pcieSlotMaxGen: null,
  driveKey: null
}

const NON_SMB_UNC_HOSTS: ReadonlySet<string> = new Set([
  '.',
  'wsl$',
  'wsl.localhost',
  'tsclient',
  'vboxsvr',
  'vboxsrv',
  'vmware-host',
  'mac'
])

function uncFsType(host: string, share: string): string | null {
  if (host === '' || share === '' || NON_SMB_UNC_HOSTS.has(host.toLowerCase())) return null
  return host.includes('@') || share.toLowerCase() === 'davwwwroot' ? 'webdav' : 'smb'
}

function resolveWindows(p: string, snap: StorageSnapshot): DriveInfo {
  let resolved = path.win32.resolve(p)
  if (resolved.startsWith('\\\\?\\UNC\\')) resolved = `\\\\${resolved.slice(8)}`
  else if (resolved.startsWith('\\\\?\\')) resolved = resolved.slice(4)
  if (resolved.startsWith('\\\\')) {
    const parts = resolved.slice(2).split('\\')
    const shareRoot = `\\\\${parts.slice(0, 2).join('\\')}`.toLowerCase()
    return networkInfo(null, `net:${shareRoot}`, uncFsType(parts[0] ?? '', parts[1] ?? ''))
  }
  const root = path.win32.parse(resolved).root
  if (!/^[a-z]:[\\/]?$/i.test(root)) return UNRESOLVED
  const letter = root.slice(0, 2).toUpperCase()

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
  return classify(volume, bd, dl, `vol:${letter}`, snap.pcie)
}

function findPosixVolume(
  resolved: string,
  volumes: Systeminformation.FsSizeData[]
): Systeminformation.FsSizeData | null {
  let best: Systeminformation.FsSizeData | null = null
  let bestLen = -1
  for (const v of volumes) {
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
  if (NETWORK_FS_TYPES.has(fsType) || /^[^/\\]+:/.test(fsDev) || fsDev.startsWith('//')) {
    return networkInfo(volume, `net:${volume.mount}`)
  }

  const devName = stripDevPrefix(fsDev)
  const bd =
    snap.blockDevices.find((d) => (d.mount ?? '') === volume.mount) ??
    snap.blockDevices.find((d) => d.name === devName && devName !== '') ??
    null

  const parentDev = (bd?.device ?? '').trim()
  const parentName = stripDevPrefix(parentDev)
  const dl = parentName
    ? (snap.diskLayout.find((d) => stripDevPrefix(d.device?.trim() ?? '') === parentName) ?? null)
    : null

  const fallbackKey = `vol:${volume.mount}`
  return classify(volume, bd, dl, fallbackKey, snap.pcie)
}

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

export function _resetForTest(): void {
  inflightProbe = null
  cachedSnapshot = null
}
