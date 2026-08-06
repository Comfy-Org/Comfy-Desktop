import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Per-test fixture data returned by the mocked systeminformation probes.
let mockFsSize: unknown[] = []
let mockBlockDevices: unknown[] = []
let mockDiskLayout: unknown[] = []
let mockShouldThrow = false

vi.mock('systeminformation', () => ({
  default: {
    fsSize: () =>
      mockShouldThrow ? Promise.reject(new Error('probe failed')) : Promise.resolve(mockFsSize),
    blockDevices: () => Promise.resolve(mockBlockDevices),
    diskLayout: () => Promise.resolve(mockDiskLayout)
  }
}))

import { classifyPaths, _resetForTest } from './storageInfo'

const realPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

beforeEach(() => {
  _resetForTest()
  mockFsSize = []
  mockBlockDevices = []
  mockDiskLayout = []
  mockShouldThrow = false
})

afterEach(() => {
  setPlatform(realPlatform)
})

const GB = 1_073_741_824

// --- Windows fixtures -------------------------------------------------------

function windowsFixtures(): void {
  mockFsSize = [
    { fs: 'C:', type: 'NTFS', size: 2000 * GB, available: 500 * GB, mount: 'C:' },
    { fs: 'D:', type: 'NTFS', size: 4000 * GB, available: 1000 * GB, mount: 'D:' },
    { fs: 'Z:', type: 'NTFS', size: 8000 * GB, available: 2000 * GB, mount: 'Z:' }
  ]
  mockBlockDevices = [
    {
      name: 'C:',
      mount: 'C:',
      type: 'disk',
      fsType: 'ntfs',
      physical: 'Local',
      removable: false,
      protocol: '',
      device: '\\\\.\\PHYSICALDRIVE0'
    },
    {
      name: 'D:',
      mount: 'D:',
      type: 'disk',
      fsType: 'ntfs',
      physical: 'Local',
      removable: false,
      protocol: '',
      device: '\\\\.\\PHYSICALDRIVE1'
    },
    {
      name: 'Z:',
      mount: 'Z:',
      type: 'disk',
      fsType: 'ntfs',
      physical: 'Network',
      removable: false,
      protocol: '',
      device: ''
    }
  ]
  mockDiskLayout = [
    {
      device: '\\\\.\\PHYSICALDRIVE0',
      type: 'SSD',
      name: 'Samsung SSD 990 PRO 2TB',
      vendor: 'Samsung',
      size: 2000 * GB,
      interfaceType: 'NVMe'
    },
    {
      device: '\\\\.\\PHYSICALDRIVE1',
      type: 'HD',
      name: 'WDC WD40EZRZ-00GXCB0',
      vendor: 'Western Digital',
      size: 4000 * GB,
      interfaceType: 'SATA'
    }
  ]
}

describe('classifyPaths - Windows', () => {
  beforeEach(() => {
    setPlatform('win32')
    windowsFixtures()
  })

  it('classifies an NVMe system drive', async () => {
    const map = await classifyPaths(['C:\\Users\\u\\ComfyUI-Installs\\a'])
    const info = map.get('C:\\Users\\u\\ComfyUI-Installs\\a')!
    expect(info.storageClass).toBe('nvme_ssd')
    expect(info.bus).toBe('nvme')
    expect(info.driveModel).toBe('Samsung SSD 990 PRO 2TB')
    expect(info.driveVendor).toBe('Samsung')
    expect(info.driveSizeGb).toBe(2000)
    expect(info.volumeFreeGb).toBe(500)
    expect(info.fsType).toBe('ntfs')
    expect(info.external).toBe(false)
    expect(info.driveKey).not.toBeNull()
  })

  it('classifies a SATA HDD', async () => {
    const map = await classifyPaths(['D:\\models'])
    const info = map.get('D:\\models')!
    expect(info.storageClass).toBe('hdd')
    expect(info.bus).toBe('sata')
    expect(info.driveModel).toBe('WDC WD40EZRZ-00GXCB0')
  })

  it('groups paths on the same physical drive and separates different drives', async () => {
    const map = await classifyPaths(['C:\\a', 'c:\\b\\deeper', 'D:\\models'])
    const a = map.get('C:\\a')!
    const b = map.get('c:\\b\\deeper')!
    const d = map.get('D:\\models')!
    expect(a.driveKey).toBe(b.driveKey)
    expect(a.driveKey).not.toBe(d.driveKey)
  })

  it('classifies mapped network drives and UNC paths as network', async () => {
    const map = await classifyPaths(['Z:\\shared\\models', '\\\\nas\\models\\sdxl'])
    expect(map.get('Z:\\shared\\models')!.storageClass).toBe('network')
    const unc = map.get('\\\\nas\\models\\sdxl')!
    expect(unc.storageClass).toBe('network')
    expect(unc.bus).toBe('network')
    expect(unc.driveKey).toBe('net:\\\\nas\\models')
  })

  it('classifies a USB SSD as other_ssd and external', async () => {
    mockDiskLayout = [
      {
        device: '\\\\.\\PHYSICALDRIVE0',
        type: 'SSD',
        name: 'Samsung Portable SSD T7',
        vendor: 'Samsung',
        size: 1000 * GB,
        interfaceType: 'USB'
      }
    ]
    const map = await classifyPaths(['C:\\stuff'])
    const info = map.get('C:\\stuff')!
    expect(info.storageClass).toBe('other_ssd')
    expect(info.bus).toBe('usb')
    expect(info.external).toBe(true)
  })

  it('classifies Storage Spaces as virtual', async () => {
    mockDiskLayout = [
      {
        device: '\\\\.\\PHYSICALDRIVE0',
        type: 'SSD',
        name: 'Microsoft Storage Space Device',
        vendor: 'Microsoft',
        size: 8000 * GB,
        interfaceType: 'Storage Spaces'
      }
    ]
    const map = await classifyPaths(['C:\\pool'])
    expect(map.get('C:\\pool')!.storageClass).toBe('virtual')
  })

  it('classifies the real Get-PhysicalDisk bus value "Spaces" as virtual', async () => {
    mockDiskLayout = [
      {
        device: '\\\\.\\PHYSICALDRIVE0',
        type: 'SSD',
        name: 'Storage Space',
        vendor: 'Microsoft',
        size: 8000 * GB,
        interfaceType: 'Spaces'
      }
    ]
    const map = await classifyPaths(['C:\\pool'])
    expect(map.get('C:\\pool')!.storageClass).toBe('virtual')
    expect(map.get('C:\\pool')!.bus).toBe('virtual')
  })

  it('normalizes extended-length \\\\?\\ paths to their local drive', async () => {
    const map = await classifyPaths(['\\\\?\\C:\\Users\\u\\ComfyUI', '\\\\?\\UNC\\nas\\models\\x'])
    expect(map.get('\\\\?\\C:\\Users\\u\\ComfyUI')!.storageClass).toBe('nvme_ssd')
    const unc = map.get('\\\\?\\UNC\\nas\\models\\x')!
    expect(unc.storageClass).toBe('network')
    expect(unc.driveKey).toBe('net:\\\\nas\\models')
  })

  it('nulls malformed model/vendor strings that look like paths, devices or UUIDs', async () => {
    mockDiskLayout = [
      {
        device: '\\\\.\\PHYSICALDRIVE0',
        type: 'SSD',
        name: '\\\\.\\PHYSICALDRIVE0',
        vendor: 'Volume{2f5e3c6a-90d2-4a3f-8f10-84f5c2a7b9e1}',
        size: 2000 * GB,
        interfaceType: 'NVMe'
      },
      {
        device: '\\\\.\\PHYSICALDRIVE1',
        type: 'HD',
        name: '2f5e3c6a-90d2-4a3f-8f10-84f5c2a7b9e1',
        vendor: '1234567890',
        size: 4000 * GB,
        interfaceType: 'SATA'
      }
    ]
    const map = await classifyPaths(['C:\\a', 'D:\\b'])
    const a = map.get('C:\\a')!
    expect(a.driveModel).toBeNull()
    expect(a.driveVendor).toBeNull()
    expect(a.storageClass).toBe('nvme_ssd') // classification is unaffected
    const b = map.get('D:\\b')!
    expect(b.driveModel).toBeNull() // bare UUID
    expect(b.driveVendor).toBeNull() // digits only (serial-ish)
  })

  it('reduces unrecognized filesystem types to "other"', async () => {
    mockFsSize = [
      { fs: 'C:', type: 'WeirdFS-v2 C:\\secret', size: 100 * GB, available: 10 * GB, mount: 'C:' }
    ]
    mockBlockDevices = []
    mockDiskLayout = []
    const map = await classifyPaths(['C:\\x'])
    expect(map.get('C:\\x')!.fsType).toBe('other')
  })

  it('resolves to the volume with unknown media when the physical join fails', async () => {
    mockDiskLayout = []
    const map = await classifyPaths(['C:\\x'])
    const info = map.get('C:\\x')!
    expect(info.storageClass).toBe('unknown')
    // The block-device link still allows same-drive grouping.
    expect(info.driveKey).toBe('\\\\.\\PHYSICALDRIVE0')
    expect(info.volumeSizeGb).toBe(2000)
  })

  it('falls back to a volume-level key when only fsSize knows the volume', async () => {
    mockDiskLayout = []
    mockBlockDevices = []
    const map = await classifyPaths(['C:\\x'])
    const info = map.get('C:\\x')!
    expect(info.storageClass).toBe('unknown')
    expect(info.driveKey).toBe('vol:C:')
  })

  it('returns unknown with a null driveKey for an unmatched volume', async () => {
    const map = await classifyPaths(['Q:\\nothere'])
    const info = map.get('Q:\\nothere')!
    expect(info.storageClass).toBe('unknown')
    expect(info.driveKey).toBeNull()
  })

  it('never rejects when the probes fail; everything is unknown', async () => {
    mockShouldThrow = true
    const map = await classifyPaths(['C:\\a', 'D:\\b'])
    expect(map.get('C:\\a')!.storageClass).toBe('unknown')
    expect(map.get('D:\\b')!.driveKey).toBeNull()
  })
})

// --- Linux fixtures ---------------------------------------------------------

describe('classifyPaths - Linux', () => {
  beforeEach(() => {
    setPlatform('linux')
    mockFsSize = [
      { fs: '/dev/nvme0n1p2', type: 'ext4', size: 1000 * GB, available: 300 * GB, mount: '/' },
      {
        fs: '/dev/sda1',
        type: 'ext4',
        size: 4000 * GB,
        available: 2000 * GB,
        mount: '/mnt/models'
      },
      { fs: 'nas:/export', type: 'nfs', size: 8000 * GB, available: 100 * GB, mount: '/mnt/nas' }
    ]
    mockBlockDevices = [
      {
        name: 'nvme0n1p2',
        mount: '/',
        type: 'part',
        fsType: 'ext4',
        physical: '',
        removable: false,
        protocol: 'nvme',
        device: '/dev/nvme0n1'
      },
      {
        name: 'sda1',
        mount: '/mnt/models',
        type: 'part',
        fsType: 'ext4',
        physical: '',
        removable: false,
        protocol: 'sata',
        device: '/dev/sda'
      }
    ]
    mockDiskLayout = [
      {
        device: '/dev/nvme0n1',
        type: 'NVMe',
        name: 'WD_BLACK SN850X 1000GB',
        vendor: 'Western Digital',
        size: 1000 * GB,
        interfaceType: 'PCIe'
      },
      {
        device: '/dev/sda',
        type: 'HD',
        name: 'ST4000DM004-2CV104',
        vendor: 'Seagate',
        size: 4000 * GB,
        interfaceType: 'SATA'
      }
    ]
  })

  it('classifies NVMe root and SATA HDD mounts', async () => {
    const map = await classifyPaths(['/home/u/comfy', '/mnt/models/checkpoints'])
    expect(map.get('/home/u/comfy')!.storageClass).toBe('nvme_ssd')
    const models = map.get('/mnt/models/checkpoints')!
    expect(models.storageClass).toBe('hdd')
    expect(models.bus).toBe('sata')
  })

  it('is path-component aware when matching mounts', async () => {
    // "/mnt/modelsX" is NOT under the "/mnt/models" mount - falls to "/".
    const map = await classifyPaths(['/mnt/modelsX/file'])
    expect(map.get('/mnt/modelsX/file')!.storageClass).toBe('nvme_ssd')
  })

  it('classifies NFS mounts as network', async () => {
    const map = await classifyPaths(['/mnt/nas/models'])
    const info = map.get('/mnt/nas/models')!
    expect(info.storageClass).toBe('network')
    expect(info.driveKey).toBe('net:/mnt/nas')
  })

  it('classifies rclone-style FUSE mounts as network', async () => {
    mockFsSize.push({
      fs: 'gdrive:models',
      type: 'fuse.rclone',
      size: 0,
      available: 0,
      mount: '/mnt/rclone'
    })
    const map = await classifyPaths(['/mnt/rclone/checkpoints'])
    expect(map.get('/mnt/rclone/checkpoints')!.storageClass).toBe('network')
  })

  it('classifies LVM and RAID block devices as virtual', async () => {
    mockFsSize.push({
      fs: '/dev/mapper/vg0-models',
      type: 'ext4',
      size: 8000 * GB,
      available: 4000 * GB,
      mount: '/mnt/lvm'
    })
    mockBlockDevices.push({
      name: 'vg0-models',
      mount: '/mnt/lvm',
      type: 'lvm',
      fsType: 'ext4',
      physical: 'SSD',
      removable: false,
      protocol: '',
      device: ''
    })
    const map = await classifyPaths(['/mnt/lvm/checkpoints'])
    const info = map.get('/mnt/lvm/checkpoints')!
    expect(info.storageClass).toBe('virtual')
  })

  it('matches mounts reported with a trailing slash', async () => {
    mockFsSize.push({
      fs: '/dev/sdb1',
      type: 'ext4',
      size: 2000 * GB,
      available: 1000 * GB,
      mount: '/mnt/extra/'
    })
    const map = await classifyPaths(['/mnt/extra/models'])
    const info = map.get('/mnt/extra/models')!
    // Matched the /mnt/extra/ volume (2000 GB), not the / root volume.
    expect(info.volumeSizeGb).toBe(2000)
  })
})

// --- macOS fallback ---------------------------------------------------------

describe('classifyPaths - macOS volume-level fallback', () => {
  beforeEach(() => {
    setPlatform('darwin')
    mockFsSize = [
      { fs: '/dev/disk3s1', type: 'APFS', size: 1000 * GB, available: 400 * GB, mount: '/' }
    ]
    // No usable diskLayout join; blockDevices carries media + protocol.
    mockBlockDevices = [
      {
        name: 'disk3s1',
        mount: '/',
        type: 'part',
        fsType: 'apfs',
        physical: 'SSD',
        removable: false,
        protocol: 'PCI-Express',
        device: ''
      }
    ]
    mockDiskLayout = []
  })

  it('falls back to blockDevices media and protocol', async () => {
    const map = await classifyPaths(['/Users/u/ComfyUI'])
    const info = map.get('/Users/u/ComfyUI')!
    expect(info.storageClass).toBe('nvme_ssd') // SSD media on a PCIe bus
    expect(info.bus).toBe('pcie')
    expect(info.driveKey).toBe('vol:/')
  })
})
