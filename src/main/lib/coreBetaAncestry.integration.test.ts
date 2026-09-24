// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  ipcMain: { handle: vi.fn() }
}))

import { resolveCoreCommitState } from './coreBetaAncestry'
import { selectCoreBetaGrantArgs } from './coreBetaGrants'
import type { CoreBetaGrant, CoreVersionState } from './coreBetaGrants'

/** Real system git, no pygit2: the merge-base and fetch semantics the resolver leans on are
 *  exactly what a mock would have to assume. */
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

// upstream master:  base -> known-good -> head -> ahead
//          release:  base -> backport
// `clone` is taken at `head`, so it has never seen `ahead`.
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
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('resolveCoreCommitState against a real repository', () => {
  it('relates local SHAs without fetching', async () => {
    const state = await resolveCoreCommitState(clone, { kind: 'head', commit: sha.head! }, [
      sha.knownGood!,
      sha.head!
    ])

    expect(state.ancestry.get(sha.knownGood!)).toBe(true)
    // A commit is its own ancestor, so a range whose upper bound IS HEAD excludes it.
    expect(state.ancestry.get(sha.head!)).toBe(true)
  })

  it('fetches an upper bound the clone has never seen and proves HEAD has not reached it', async () => {
    expect(() => git(clone, 'cat-file', '-e', `${sha.ahead}^{commit}`)).toThrow()

    const state = await resolveCoreCommitState(clone, { kind: 'head', commit: sha.head! }, [
      sha.ahead!
    ])

    expect(state.ancestry.get(sha.ahead!)).toBe(false)
  })

  it('proves a commit on another lineage is not contained', async () => {
    const state = await resolveCoreCommitState(clone, { kind: 'head', commit: sha.head! }, [
      sha.backport!
    ])

    expect(state.ancestry.get(sha.backport!)).toBe(false)
  })

  it('leaves a SHA no remote has unresolved', async () => {
    const missing = '0123456789abcdef0123456789abcdef01234567'

    const state = await resolveCoreCommitState(clone, { kind: 'head', commit: sha.head! }, [
      missing
    ])

    expect(state.ancestry.has(missing)).toBe(false)
  })

  it('grants a known-good..upper range end to end, and withholds it once HEAD passes the upper bound', async () => {
    const grant: CoreBetaGrant = {
      arg: '--enable-assets',
      commitRanges: [[sha.knownGood!, sha.ahead!]]
    }
    const shas = [sha.knownGood!, sha.ahead!]

    const before = await resolveCoreCommitState(clone, { kind: 'head', commit: sha.head! }, shas)
    expect(selectCoreBetaGrantArgs([grant], NO_VERSION, true, [], before)).toEqual([grant])

    const after = await resolveCoreCommitState(clone, { kind: 'head', commit: sha.ahead! }, shas)
    expect(selectCoreBetaGrantArgs([grant], NO_VERSION, true, [], after)).toEqual([])
  })

  it('never proves non-containment in a shallow clone, even of a commit HEAD contains', async () => {
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

    // knownGood IS an ancestor upstream, but the depth-1 graph cannot show it: unresolved, not false.
    expect(state.ancestry.has(sha.knownGood!)).toBe(false)
    expect(state.ancestry.get(shallowHead)).toBe(true)
  })
})
