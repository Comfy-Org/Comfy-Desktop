import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { CoreBetaGrant } from './coreBetaGrants'
import type * as CoreBetaGrantsModule from './coreBetaGrants'
import type * as ComfyArgsModule from './comfy-args'
import type { InstallationRecord } from '../installations'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  ipcMain: { handle: vi.fn() }
}))
const h = vi.hoisted(() => ({ dir: '', grants: [] as CoreBetaGrant[] }))
vi.mock('./paths', () => ({ configDir: () => h.dir }))
vi.mock('../settings', () => ({ peekBetaFeaturesEnabled: () => true }))
vi.mock('./coreBetaGrants', async (importOriginal) => ({
  ...(await importOriginal<typeof CoreBetaGrantsModule>()),
  getCoreBetaGrantsAsync: async () => h.grants
}))
vi.mock('./comfy-args', async (importOriginal) => ({
  ...(await importOriginal<typeof ComfyArgsModule>()),
  peekComfyArgsSchema: () => ({ args: [], knownFlags: new Set(['enable-agent', 'enable-assets']) })
}))

import { _backgroundFetchesForTest } from './coreBetaAncestry'
import { _resetForTest, previewCoreBetaArgs } from './coreBetaPreview'

// The preview end to end against real repositories: real git, real checkout reads, no fetch.

/** Git variables a test run can inherit (from a hook, say) that would point git, the product's
 *  calls included, at another repo. Cleared from the environment for the suite. */
const INHERITED_GIT_STATE = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_CEILING_DIRECTORIES'
]

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

let root = ''
let upstream = ''
const sha: Record<string, string> = {}

/** A fresh clone of upstream's master, so a test may move or damage it. */
function cloneOf(name: string, ...flags: string[]): string {
  const dir = path.join(root, name)
  git(root, 'clone', '-q', '--single-branch', '-b', 'master', ...flags, `file://${upstream}`, dir)
  return dir
}

const agentFrom = (lower: string, upper: string | null = null): CoreBetaGrant => ({
  arg: '--enable-agent',
  commitRanges: [[lower, upper]]
})
const assetsFrom = (lower: string, upper: string | null = null): CoreBetaGrant => ({
  arg: '--enable-assets',
  commitRanges: [[lower, upper]]
})

function preview(repo: string) {
  const inst = {
    id: 'inst',
    comfyVersion: { commit: git(repo, 'rev-parse', 'HEAD') }
  } as unknown as InstallationRecord
  return previewCoreBetaArgs('inst', inst, {
    cmd: '/python',
    args: ['-s', path.join(repo, 'main.py')],
    cwd: repo
  })
}

const has = (repo: string, commitSha: string): boolean => {
  try {
    git(repo, 'cat-file', '-e', `${commitSha}^{commit}`)
    return true
  } catch {
    return false
  }
}

const inheritedGitState: Record<string, string | undefined> = {}

beforeAll(() => {
  for (const key of INHERITED_GIT_STATE) {
    inheritedGitState[key] = process.env[key]
    delete process.env[key]
  }
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'core-beta-preview-'))
  upstream = path.join(root, 'upstream')
  fs.mkdirSync(upstream)
  git(upstream, 'init', '-q', '-b', 'master')
  git(upstream, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
  sha.base = commit(upstream, 'base')
  sha.fix = commit(upstream, 'fix')
  sha.head = commit(upstream, 'head')
  sha.later = commit(upstream, 'later')
  git(upstream, 'reset', '-q', '--hard', sha.head)
  git(upstream, 'branch', 'future', sha.later)
})

afterAll(() => {
  for (const [key, value] of Object.entries(inheritedGitState)) {
    if (value !== undefined) process.env[key] = value
  }
  fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  _resetForTest()
  h.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-beta-preview-store-'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
  await _backgroundFetchesForTest()
  fs.rmSync(h.dir, { recursive: true, force: true })
})

describe('previewCoreBetaArgs against a real repository', () => {
  it('shows a commit grant whose range contains HEAD, with no launch at all', async () => {
    const repo = cloneOf('contains')
    h.grants = [agentFrom(sha.fix!, sha.later!)]
    await expect(preview(repo)).resolves.toEqual([{ arg: '--enable-agent', name: null }])
  })

  // `[]` alone cannot tell a proven answer from an unprovable one, so each negative is paired, in
  // the same preview, with a grant that shows only if the preview proved the same relation.
  it('hides it once HEAD is below the range, having proven the lower bound absent', async () => {
    const repo = cloneOf('below')
    git(repo, 'reset', '-q', '--hard', sha.base!)
    h.grants = [agentFrom(sha.fix!), assetsFrom(sha.base!, sha.fix!)]
    await expect(preview(repo)).resolves.toEqual([{ arg: '--enable-assets', name: null }])
  })

  it('hides it once HEAD has passed the upper bound, having proven it contained', async () => {
    const repo = cloneOf('past')
    h.grants = [agentFrom(sha.base!, sha.fix!), assetsFrom(sha.fix!)]
    await expect(preview(repo)).resolves.toEqual([{ arg: '--enable-assets', name: null }])
  })

  it('grants below an upper bound a full clone has never seen, which needs a proven "not contained"', async () => {
    const repo = cloneOf('never-seen')
    expect(has(repo, sha.later!)).toBe(false)
    h.grants = [agentFrom(sha.base!, sha.later!)]
    await expect(preview(repo)).resolves.toEqual([{ arg: '--enable-agent', name: null }])
  })

  it('hides a grant a shallow clone cannot settle, and fetches nothing to settle it', async () => {
    const repo = cloneOf('shallow', '--depth', '1')
    expect(has(repo, sha.fix!)).toBe(false)
    h.grants = [agentFrom(sha.fix!)]

    await expect(preview(repo)).resolves.toEqual([])
    await _backgroundFetchesForTest()
    expect(has(repo, sha.fix!), 'the preview must not fetch').toBe(false)
  })

  it('hides the grant, and still answers, when the object store is damaged', async () => {
    const repo = cloneOf('corrupt')
    const objects = path.join(repo, '.git', 'objects')
    for (const entry of fs.readdirSync(objects)) {
      if (entry !== 'info') fs.rmSync(path.join(objects, entry), { recursive: true, force: true })
    }
    h.grants = [agentFrom(sha.fix!)]
    await expect(preview(repo)).resolves.toEqual([])
  })

  it('follows HEAD: a new commit is a new key, and the answer is proven again', async () => {
    const repo = cloneOf('moving')
    git(repo, 'reset', '-q', '--hard', sha.base!)
    h.grants = [agentFrom(sha.fix!)]
    await expect(preview(repo)).resolves.toEqual([])

    git(repo, 'reset', '-q', '--hard', sha.head!)
    await expect(preview(repo)).resolves.toEqual([{ arg: '--enable-agent', name: null }])
  })
})
