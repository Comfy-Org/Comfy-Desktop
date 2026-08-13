import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

import { deviceLookupKey, probePcieLinkCaps, _internal } from './pcieInfo'

const { normalizeGen, parseLinkSpeedToGen, parseWindowsPcieOutput, probeLinuxSysfs } = _internal

const realPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

afterEach(() => {
  setPlatform(realPlatform)
})

describe('deviceLookupKey', () => {
  it('normalizes Windows physical drive paths', () => {
    expect(deviceLookupKey('\\\\.\\PHYSICALDRIVE0')).toBe('physicaldrive0')
  })

  it('normalizes Linux device nodes', () => {
    expect(deviceLookupKey('/dev/nvme0n1')).toBe('nvme0n1')
  })

  it('passes through bare names', () => {
    expect(deviceLookupKey(' NVMe0n1 ')).toBe('nvme0n1')
  })
})

describe('normalizeGen', () => {
  it('accepts generations 1-6', () => {
    for (const g of [1, 2, 3, 4, 5, 6]) expect(normalizeGen(g)).toBe(g)
  })

  it('accepts numeric strings', () => {
    expect(normalizeGen('4')).toBe(4)
  })

  it('rejects out-of-range, fractional and junk values', () => {
    expect(normalizeGen(0)).toBeNull()
    expect(normalizeGen(7)).toBeNull()
    expect(normalizeGen(3.5)).toBeNull()
    expect(normalizeGen('x')).toBeNull()
    expect(normalizeGen(null)).toBeNull()
    expect(normalizeGen(undefined)).toBeNull()
  })
})

describe('parseLinkSpeedToGen', () => {
  it('maps sysfs link-speed strings to generations', () => {
    expect(parseLinkSpeedToGen('2.5 GT/s PCIe')).toBe(1)
    expect(parseLinkSpeedToGen('5.0 GT/s PCIe')).toBe(2)
    expect(parseLinkSpeedToGen('8.0 GT/s PCIe')).toBe(3)
    expect(parseLinkSpeedToGen('16.0 GT/s PCIe')).toBe(4)
    expect(parseLinkSpeedToGen('32.0 GT/s PCIe')).toBe(5)
    expect(parseLinkSpeedToGen('64.0 GT/s PCIe')).toBe(6)
  })

  it('tolerates the bare GT/s form without the PCIe suffix', () => {
    expect(parseLinkSpeedToGen('16.0 GT/s')).toBe(4)
  })

  it('returns null for unknown or malformed values', () => {
    expect(parseLinkSpeedToGen('Unknown speed')).toBeNull()
    expect(parseLinkSpeedToGen('')).toBeNull()
    expect(parseLinkSpeedToGen('12.0 GT/s PCIe')).toBeNull()
    expect(parseLinkSpeedToGen(null)).toBeNull()
  })
})

describe('parseWindowsPcieOutput', () => {
  it('parses an array of drives keyed by physicaldrive index', () => {
    const map = parseWindowsPcieOutput(
      JSON.stringify([
        { index: 0, maxGen: 4, slotMaxGen: 4 },
        { index: 2, maxGen: 3, slotMaxGen: null }
      ])
    )
    expect(map.get('physicaldrive0')).toEqual({ maxGen: 4, slotMaxGen: 4 })
    expect(map.get('physicaldrive2')).toEqual({ maxGen: 3, slotMaxGen: null })
    expect(map.size).toBe(2)
  })

  it('accepts a single-object payload', () => {
    const map = parseWindowsPcieOutput(JSON.stringify({ index: 1, maxGen: 5, slotMaxGen: 5 }))
    expect(map.get('physicaldrive1')).toEqual({ maxGen: 5, slotMaxGen: 5 })
  })

  it('drops rows with bad indices, all-null caps, or out-of-range gens', () => {
    const map = parseWindowsPcieOutput(
      JSON.stringify([
        { index: -1, maxGen: 4, slotMaxGen: 4 },
        { index: 'x', maxGen: 4, slotMaxGen: 4 },
        { index: 3, maxGen: null, slotMaxGen: null },
        { index: 4, maxGen: 99, slotMaxGen: 0 },
        null
      ])
    )
    expect(map.size).toBe(0)
  })

  it('returns empty on non-JSON garbage', () => {
    expect(parseWindowsPcieOutput('not json').size).toBe(0)
    expect(parseWindowsPcieOutput('').size).toBe(0)
  })
})

describe('probeLinuxSysfs', () => {
  async function makeSysBlock(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), 'pcie-sysfs-'))
  }

  async function writeDevice(
    root: string,
    name: string,
    endpointSpeed: string | null,
    portSpeed: string | null
  ): Promise<void> {
    // Layout mirrors the traversal: <name>/device/device/max_link_speed is
    // the endpoint, and (with no symlinks) the parent dir <name>/device/
    // max_link_speed stands in for the upstream port.
    const pciDir = path.join(root, name, 'device', 'device')
    await fs.mkdir(pciDir, { recursive: true })
    if (endpointSpeed !== null) {
      await fs.writeFile(path.join(pciDir, 'max_link_speed'), `${endpointSpeed}\n`)
    }
    if (portSpeed !== null) {
      await fs.writeFile(path.join(root, name, 'device', 'max_link_speed'), `${portSpeed}\n`)
    }
  }

  it('reads endpoint and port max link speeds for nvme devices', async () => {
    const root = await makeSysBlock()
    try {
      await writeDevice(root, 'nvme0n1', '16.0 GT/s PCIe', '8.0 GT/s PCIe')
      const map = await probeLinuxSysfs(root)
      expect(map.get('nvme0n1')).toEqual({ maxGen: 4, slotMaxGen: 3 })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('ignores non-nvme block devices and devices without PCIe attributes', async () => {
    const root = await makeSysBlock()
    try {
      await writeDevice(root, 'sda', '16.0 GT/s PCIe', null)
      await fs.mkdir(path.join(root, 'nvme1n1', 'device'), { recursive: true })
      const map = await probeLinuxSysfs(root)
      expect(map.size).toBe(0)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('keeps a device with only one of the two speeds', async () => {
    const root = await makeSysBlock()
    try {
      await writeDevice(root, 'nvme0n1', '32.0 GT/s PCIe', null)
      const map = await probeLinuxSysfs(root)
      expect(map.get('nvme0n1')).toEqual({ maxGen: 5, slotMaxGen: null })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('resolves empty for a missing sysfs root', async () => {
    const map = await probeLinuxSysfs(path.join(os.tmpdir(), 'pcie-sysfs-does-not-exist'))
    expect(map.size).toBe(0)
  })
})

describe('probePcieLinkCaps', () => {
  it('resolves empty on unsupported platforms', async () => {
    setPlatform('darwin')
    const map = await probePcieLinkCaps()
    expect(map.size).toBe(0)
  })
})
