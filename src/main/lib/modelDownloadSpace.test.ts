import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DISK_SPACE_RESERVE_BYTES, diskSpaceShortfall } from './modelDownloadSpace'

let tmpDir: string
let stagingPath: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-space-test-'))
  stagingPath = path.join(tmpDir, 'model.safetensors.part')
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function freeBytes(bytes: number): void {
  vi.spyOn(fs, 'statfsSync').mockReturnValue({ bavail: bytes, bsize: 1 } as never)
}

describe('diskSpaceShortfall', () => {
  it('passes when the file and the reserve fit', () => {
    freeBytes(DISK_SPACE_RESERVE_BYTES + 3_000_000_000)
    expect(diskSpaceShortfall(stagingPath, 3_000_000_000)).toBeNull()
  })

  it('names what the download needs and what the drive has', () => {
    freeBytes(2_000_000_000)
    expect(diskSpaceShortfall(stagingPath, 20_500_000_000)).toBe(
      'Not enough disk space: this download needs 21.0 GB free and the drive has 2.0 GB'
    )
  })

  it('subtracts bytes already staged', () => {
    fs.writeFileSync(stagingPath, Buffer.alloc(4096))
    freeBytes(DISK_SPACE_RESERVE_BYTES + 100)
    expect(diskSpaceShortfall(stagingPath, 4096 + 100)).toBeNull()
  })

  it('passes when every byte is already staged', () => {
    fs.writeFileSync(stagingPath, Buffer.alloc(10))
    freeBytes(0)
    expect(diskSpaceShortfall(stagingPath, 10)).toBeNull()
  })

  it.skipIf(process.platform === 'win32')(
    'counts only written bytes in a sparse staging file',
    () => {
      fs.writeFileSync(stagingPath, '')
      fs.truncateSync(stagingPath, 1_000_000_000)
      freeBytes(DISK_SPACE_RESERVE_BYTES)
      expect(diskSpaceShortfall(stagingPath, 1_000_000_000)).toMatch(/^Not enough disk space: /)
    }
  )

  it('skips the check when the size is unknown or free space cannot be read', () => {
    const statfs = vi.spyOn(fs, 'statfsSync')
    expect(diskSpaceShortfall(stagingPath, 0)).toBeNull()
    expect(statfs).not.toHaveBeenCalled()
    statfs.mockImplementation(() => {
      throw new Error('ENOSYS')
    })
    expect(diskSpaceShortfall(stagingPath, 10)).toBeNull()
  })
})
