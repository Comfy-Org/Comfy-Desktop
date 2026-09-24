import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  ipcMain: { handle: vi.fn() }
}))
const store = vi.hoisted(() => ({ dir: '' }))
vi.mock('./paths', () => ({ configDir: () => store.dir }))

import { _backgroundFetchesForTest, resolveCoreCommitState } from './coreBetaAncestry'
import { selectCoreBetaGrantArgs } from './coreBetaGrants'
import type { CoreBetaGrant, CoreVersionState } from './coreBetaGrants'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: os.devNull
    }
  }).trim()
}

function commit(cwd: string, message: string): string {
  git(cwd, 'commit', '--allow-empty', '-q', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

const NO_VERSION: CoreVersionState = { semver: null, exact: false, verified: false, current: true }

let root = ''
let upstream = ''
let clone = ''
const sha: Record<string, string> = {}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-beta-ancestry-'))
  upstream = path.join(root, 'upstream')
  clone = path.join(root, 'clone')
  fs.mkdirSync(upstream)
  git(upstream, 'init', '-q', '-b', 'master')
  git(upstream, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
  sha.base = commit(upstream, 'base')
  git(upstream, 'branch', 'release')
  sha.knownGood = commit(upstream, 'known-good')
  sha.head = commit(upstream, 'head')
  git(upstream, 'checkout', '-q', 'release')
  sha.backport = commit(upstream, 'backport')
  git(upstream, 'checkout', '-q', 'master')
  git(root, 'clone', '-q', '--single-branch', '-b', 'master', upstream, clone)
  sha.ahead = commit(upstream, 'ahead')
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  store.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-beta-store-'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
  await _backgroundFetchesForTest()
  fs.rmSync(store.dir, { recursive: true, force: true })
})

describe('resolveCoreCommitState against a real repository', () => {
  it('relates local SHAs without fetching', async () => {
    const state = await resolveCoreCommitState(clone, { kind: 'head', commit: sha.head! }, [
      sha.knownGood!,
      sha.head!
    ])

    expect(state.ancestry.get(sha.knownGood!)).toBe(true)
    expect(
      state.ancestry.get(sha.head!),
      'a commit is its own ancestor, so an upper bound AT HEAD excludes it'
    ).toBe(true)
  })

  it('proves HEAD has not reached an upper bound a full clone has never seen, without fetching', async () => {
    expect(() => git(clone, 'cat-file', '-e', `${sha.ahead}^{commit}`)).toThrow()

    const state = await resolveCoreCommitState(clone, { kind: 'head', commit: sha.head! }, [
      sha.ahead!
    ])
    await _backgroundFetchesForTest()

    expect(state.ancestry.get(sha.ahead!)).toBe(false)
    expect(
      () => git(clone, 'cat-file', '-e', `${sha.ahead}^{commit}`),
      'still absent afterwards: nothing was fetched'
    ).toThrow()
  })

  it('proves a commit on another lineage is not contained', async () => {
    const state = await resolveCoreCommitState(clone, { kind: 'head', commit: sha.head! }, [
      sha.backport!
    ])

    expect(state.ancestry.get(sha.backport!)).toBe(false)
  })

  it('reads a SHA no remote has as not contained on a full clone', async () => {
    const missing = '0123456789abcdef0123456789abcdef01234567'

    const state = await resolveCoreCommitState(clone, { kind: 'head', commit: sha.head! }, [
      missing
    ])

    expect(state.ancestry.get(missing)).toBe(false)
  })

  it('grants a known-good..upper range end to end, and withholds it once HEAD passes the upper bound', async () => {
    const grant: CoreBetaGrant = {
      arg: '--enable-assets',
      commitRanges: [[sha.knownGood!, sha.ahead!]]
    }
    const shas = [sha.knownGood!, sha.ahead!]

    const before = await resolveCoreCommitState(clone, { kind: 'head', commit: sha.head! }, shas)
    expect(selectCoreBetaGrantArgs([grant], NO_VERSION, true, [], before)).toEqual([grant])

    git(clone, 'fetch', '-q', 'origin', 'master')
    const after = await resolveCoreCommitState(clone, { kind: 'head', commit: sha.ahead! }, shas)
    expect(selectCoreBetaGrantArgs([grant], NO_VERSION, true, [], after)).toEqual([])
  })

  it('leaves an ancestor the depth-1 graph cannot show unresolved', async () => {
    const shallow = path.join(root, 'shallow')
    git(
      root,
      'clone',
      '-q',
      '--depth',
      '1',
      '--single-branch',
      '-b',
      'master',
      `file://${upstream}`,
      shallow
    )
    const shallowHead = git(shallow, 'rev-parse', 'HEAD')

    const state = await resolveCoreCommitState(shallow, { kind: 'head', commit: shallowHead }, [
      sha.knownGood!,
      shallowHead
    ])

    expect(
      state.ancestry.has(sha.knownGood!),
      'an ancestor the depth-1 graph cannot show is unresolved, not false'
    ).toBe(false)
    expect(state.ancestry.get(shallowHead)).toBe(true)
  })
})

// master:  base -> m1 -> m2 -> M(merge of m2 + s1) -> y
// side:    base -> s1 -> x1
// `shallow` is a depth-2 clone at M, so its grafts are m2 and s1.
describe('resolveCoreCommitState against a real shallow clone', () => {
  let shallowRoot = ''
  let shallow = ''
  const s: Record<string, string> = {}

  beforeAll(() => {
    shallowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'core-beta-shallow-'))
    const up = path.join(shallowRoot, 'upstream')
    shallow = path.join(shallowRoot, 'shallow')
    fs.mkdirSync(up)
    git(up, 'init', '-q', '-b', 'master')
    git(up, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
    s.base = commit(up, 'base')
    git(up, 'checkout', '-q', '-b', 'side')
    s.s1 = commit(up, 's1')
    git(up, 'checkout', '-q', 'master')
    s.m1 = commit(up, 'm1')
    s.m2 = commit(up, 'm2')
    git(up, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side')
    s.merge = git(up, 'rev-parse', 'HEAD')
    git(
      shallowRoot,
      'clone',
      '-q',
      '--depth',
      '2',
      '--single-branch',
      '-b',
      'master',
      `file://${up}`,
      shallow
    )
    s.y = commit(up, 'y')
    git(up, 'checkout', '-q', 'side')
    s.x1 = commit(up, 'x1')
    git(up, 'checkout', '-q', 'master')
  })

  afterAll(() => {
    fs.rmSync(shallowRoot, { recursive: true, force: true })
  })

  it('is set up with grafts at m2 and s1', () => {
    const grafts = fs
      .readFileSync(path.join(shallow, '.git', 'shallow'), 'utf-8')
      .trim()
      .split('\n')
    expect(grafts.sort()).toEqual([s.m2, s.s1].sort())
  })

  /** First launch starts the fetch and cannot use it; the next launch finds the object local. */
  async function secondLaunch(target: string) {
    const first = await resolveCoreCommitState(shallow, { kind: 'head', commit: s.merge! }, [
      target
    ])
    expect(first.ancestry.has(target), 'the first launch does not wait for the fetch').toBe(false)
    await _backgroundFetchesForTest()
    return resolveCoreCommitState(shallow, { kind: 'head', commit: s.merge! }, [target])
  }

  it('trusts "not contained" for a commit newer than every graft', async () => {
    const state = await secondLaunch(s.y!)

    expect(
      state.ancestry.get(s.y!),
      'both grafts are ancestors of y, so the local graph is complete'
    ).toBe(false)
  })

  it('leaves "not contained" unresolved when a graft is not an ancestor of the commit', async () => {
    const state = await secondLaunch(s.x1!)

    expect(
      git(shallow, 'merge-base', s.x1!, s.merge!),
      'a merge-base exists, so only the graft check keeps this from reading as false'
    ).toBe(s.s1)
    expect(state.ancestry.has(s.x1!), 'graft m2 is not an ancestor of x1').toBe(false)
  })
})

describe('a failed fetch on a real shallow clone', () => {
  it('is recorded on disk and not retried by the next launch', async () => {
    const shallowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'core-beta-nofetch-'))
    const shallow = path.join(shallowRoot, 'shallow')
    git(
      shallowRoot,
      'clone',
      '-q',
      '--depth',
      '1',
      '--single-branch',
      '-b',
      'master',
      `file://${upstream}`,
      shallow
    )
    git(shallow, 'remote', 'set-url', 'origin', path.join(shallowRoot, 'gone'))
    const head = git(shallow, 'rev-parse', 'HEAD')
    const missing = '0123456789abcdef0123456789abcdef01234567'
    const log = vi.mocked(console.log)

    await resolveCoreCommitState(shallow, { kind: 'head', commit: head }, [missing])
    await _backgroundFetchesForTest()
    await resolveCoreCommitState(shallow, { kind: 'head', commit: head }, [missing])

    const lines = log.mock.calls.map((call) => String(call[0]))
    expect(lines.filter((l) => l.includes('from origin: failed'))).toHaveLength(1)
    expect(lines.some((l) => l.includes('skipped, failed at'))).toBe(true)
    fs.rmSync(shallowRoot, { recursive: true, force: true })
  })
})
