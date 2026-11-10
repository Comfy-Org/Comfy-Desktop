import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const VERIFIED_SYSTEMINFORMATION_VERSION = '5.31.5'

const LOCKFILE = path.resolve(__dirname, '..', '..', '..', 'pnpm-lock.yaml')

function resolvedVersions(lockfile: string): string[] {
  const versions = new Set<string>()
  for (const match of lockfile.matchAll(/^ {2}systeminformation@([^:(\s]+):/gm)) {
    if (match[1]) versions.add(match[1])
  }
  return [...versions]
}

describe('deviceId — systeminformation version guard', () => {
  it('resolves the systeminformation version the Windows UUID lookup was verified against', () => {
    const versions = resolvedVersions(fs.readFileSync(LOCKFILE, 'utf-8'))
    expect(
      versions,
      'systeminformation changed: recheck that on win32 si.uuid().hardware equals si.system().uuid in the new version (installation_id stability), then update this constant.'
    ).toEqual([VERIFIED_SYSTEMINFORMATION_VERSION])
  })
})
