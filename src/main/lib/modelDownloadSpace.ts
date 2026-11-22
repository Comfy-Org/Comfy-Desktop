import fs from 'fs'
import path from 'path'

export const DISK_SPACE_RESERVE_BYTES = 512 * 1024 * 1024

function freeBytesAt(dir: string): number | null {
  try {
    const stats = fs.statfsSync(dir)
    return stats.bavail * stats.bsize
  } catch {
    return null
  }
}

function stagedBytesOnDisk(stagingPath: string): number {
  try {
    const stats = fs.statSync(stagingPath)
    if (process.platform === 'win32') return stats.size
    return Math.min(stats.size, stats.blocks * 512)
  } catch {
    return 0
  }
}

function gigabytes(bytes: number): string {
  return (bytes / 1e9).toFixed(1)
}

export function diskSpaceShortfall(stagingPath: string, totalBytes: number): string | null {
  if (totalBytes <= 0) return null
  const remaining = totalBytes - stagedBytesOnDisk(stagingPath)
  if (remaining <= 0) return null
  const free = freeBytesAt(path.dirname(stagingPath))
  if (free === null) return null
  const needed = remaining + DISK_SPACE_RESERVE_BYTES
  if (needed <= free) return null
  return `Not enough disk space: this download needs ${gigabytes(needed)} GB free and the drive has ${gigabytes(free)} GB`
}
