import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

let testConfigDir = ''
vi.mock('./paths', () => ({
  configDir: () => testConfigDir
}))

import {
  readPendingIdentityMerges,
  reservePendingIdentityMerge,
  enqueuePendingIdentityMerge
} from './pendingIdentityMerge'

const FILE = 'posthog-pending-identity-merges.json'
const ANON = '0f8fad5b-d9cb-469f-a165-70867728950e'
const NEXT = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

function writeQueue(entries: unknown[]): void {
  fs.writeFileSync(path.join(testConfigDir, FILE), JSON.stringify(entries))
}

function readQueueFile(): Record<string, unknown>[] {
  return JSON.parse(fs.readFileSync(path.join(testConfigDir, FILE), 'utf-8'))
}

describe('pendingIdentityMerge record compatibility', () => {
  beforeEach(() => {
    testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-merge-'))
  })

  afterEach(() => {
    fs.rmSync(testConfigDir, { recursive: true, force: true })
  })

  it('replays a record in the existing format, with its installation id', () => {
    writeQueue([
      {
        id: 'merge-1',
        anonymousId: ANON,
        userId: 'user-a',
        nextAnonymousId: NEXT,
        installationId: 'install-id',
        personSet: { installation_id: 'install-id', is_authenticated: true }
      }
    ])
    expect(readPendingIdentityMerges()).toEqual([
      {
        id: 'merge-1',
        anonymousId: ANON,
        userId: 'user-a',
        nextAnonymousId: NEXT,
        installationId: 'install-id',
        personSet: { installation_id: 'install-id', is_authenticated: true }
      }
    ])
  })

  it('replays a record written before the installation id was known', () => {
    writeQueue([
      {
        id: 'merge-2',
        anonymousId: ANON,
        userId: 'user-a',
        nextAnonymousId: NEXT,
        personSet: { is_authenticated: true }
      }
    ])
    expect(readPendingIdentityMerges()).toEqual([
      {
        id: 'merge-2',
        anonymousId: ANON,
        userId: 'user-a',
        nextAnonymousId: NEXT,
        personSet: { is_authenticated: true }
      }
    ])
  })

  it.each([
    [
      'an existing-format record',
      'install-id',
      { installation_id: 'install-id', is_authenticated: true }
    ],
    ['a record without an installation id', undefined, { is_authenticated: true }]
  ])('defaults the person properties of %s that has none', (_label, installationId, expected) => {
    writeQueue([
      {
        id: 'merge-3',
        anonymousId: ANON,
        userId: 'user-a',
        nextAnonymousId: NEXT,
        ...(installationId ? { installationId } : {})
      }
    ])
    expect(readPendingIdentityMerges()[0]?.personSet).toEqual(expected)
  })

  it.each([
    ['empty', ''],
    ['not a string', 42],
    ['null', null]
  ])('still rejects a record whose installation id is %s', (_label, installationId) => {
    writeQueue([
      { id: 'merge-4', anonymousId: ANON, userId: 'user-a', nextAnonymousId: NEXT, installationId }
    ])
    expect(readPendingIdentityMerges()).toEqual([])
  })

  it('writes a record with a known installation id in the existing format', () => {
    const merge = reservePendingIdentityMerge({
      anonymousId: ANON,
      userId: 'user-a',
      installationId: 'install-id',
      personSet: { installation_id: 'install-id', is_authenticated: true }
    })
    expect(merge).not.toBeNull()
    const [written] = readQueueFile()
    expect(
      Object.keys(written!),
      'older versions require installationId; key order matches what they wrote'
    ).toEqual(['id', 'anonymousId', 'userId', 'nextAnonymousId', 'installationId', 'personSet'])
    expect(written!.installationId).toBe('install-id')
  })

  it('writes a record without an installation id by omitting the key', () => {
    enqueuePendingIdentityMerge({
      anonymousId: ANON,
      userId: 'user-a',
      nextAnonymousId: NEXT,
      personSet: { is_authenticated: true }
    })
    const [written] = readQueueFile()
    expect(written).not.toHaveProperty('installationId')
    expect(readPendingIdentityMerges()).toHaveLength(1)
  })
})
