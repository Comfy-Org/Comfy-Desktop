import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const git = vi.hoisted(() => ({
  findMergeBase: vi.fn<(repo: string, a: string, b: string) => Promise<string | undefined>>(),
  fetchCommitSha: vi.fn<(repo: string, sha: string) => Promise<boolean>>(),
  gitDir: ''
}))
vi.mock('./git', () => ({
  findMergeBase: (...args: [string, string, string]) => git.findMergeBase(...args),
  fetchCommitSha: (...args: [string, string]) => git.fetchCommitSha(...args),
  resolveGitDir: () => git.gitDir
}))
vi.mock('./telemetry', () => ({ getOpsFlagResult: vi.fn() }))

import { resolveCoreCommitState } from './coreBetaAncestry'
import { NO_CORE_COMMITS } from './coreBetaGrants'

const REPO = '/installs/comfy/ComfyUI'
const HEAD = 'e'.repeat(40)
const LOWER = 'a'.repeat(40)
const UPPER = 'b'.repeat(40)
const OLDER = 'f'.repeat(40)

beforeEach(() => {
  git.gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-beta-gitdir-'))
  git.findMergeBase.mockReset()
  git.fetchCommitSha.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  fs.rmSync(git.gitDir, { recursive: true, force: true })
})

const shaOf = (n: number): string => n.toString(16).padStart(40, '0')

describe('resolveCoreCommitState', () => {
  it.each([
    ['a not-git install', { kind: 'not-git' } as const],
    ['a checkout whose HEAD would not read', { kind: 'unreadable' } as const],
    ['a HEAD that is not a full SHA', { kind: 'head', commit: 'e'.repeat(12) } as const]
  ])('resolves nothing for %s, without touching git', async (_label, checkout) => {
    expect(await resolveCoreCommitState(REPO, checkout, [LOWER])).toBe(NO_CORE_COMMITS)
    expect(git.findMergeBase).not.toHaveBeenCalled()
    expect(git.fetchCommitSha).not.toHaveBeenCalled()
  })

  it('resolves nothing when the payload names no SHAs', async () => {
    expect(await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [])).toBe(
      NO_CORE_COMMITS
    )
    expect(git.findMergeBase).not.toHaveBeenCalled()
  })

  it('reads a merge-base equal to the SHA as contained, and any other as not contained', async () => {
    git.findMergeBase.mockImplementation(async (_repo, sha) => (sha === LOWER ? LOWER : OLDER))

    const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD.toUpperCase() }, [
      LOWER,
      UPPER
    ])

    expect(state.head).toBe(HEAD)
    expect([...state.ancestry]).toEqual([
      [LOWER, true],
      [UPPER, false]
    ])
    expect(git.findMergeBase).toHaveBeenCalledWith(REPO, LOWER, HEAD)
    expect(git.fetchCommitSha).not.toHaveBeenCalled()
  })

  it('compares a merge-base case-insensitively', async () => {
    git.findMergeBase.mockResolvedValue(LOWER.toUpperCase())

    const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [LOWER])

    expect(state.ancestry.get(LOWER)).toBe(true)
  })

  it('fetches a SHA the checkout lacks and asks again', async () => {
    let fetched = false
    git.findMergeBase.mockImplementation(async () => (fetched ? OLDER : undefined))
    git.fetchCommitSha.mockImplementation(async () => {
      fetched = true
      return true
    })

    const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [UPPER])

    expect(git.fetchCommitSha).toHaveBeenCalledExactlyOnceWith(REPO, UPPER)
    expect(state.ancestry.get(UPPER)).toBe(false)
  })

  it('leaves a SHA unresolved when the fetch fails', async () => {
    git.findMergeBase.mockResolvedValue(undefined)
    git.fetchCommitSha.mockResolvedValue(false)

    const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [UPPER])

    // Absent, not `false`: an upper bound must not read "could not look" as "not reached".
    expect(state.ancestry.has(UPPER)).toBe(false)
    expect(git.findMergeBase).toHaveBeenCalledTimes(1)
  })

  it('leaves a SHA unresolved when it is still unrelated after a successful fetch', async () => {
    git.findMergeBase.mockResolvedValue(undefined)
    git.fetchCommitSha.mockResolvedValue(true)

    const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [UPPER])

    expect(state.ancestry.has(UPPER)).toBe(false)
    expect(git.findMergeBase).toHaveBeenCalledTimes(2)
  })

  it('contains a throw to the one SHA and still relates the rest', async () => {
    git.findMergeBase.mockImplementation(async (_repo, sha) => {
      if (sha === LOWER) throw new Error('spawn EACCES')
      return OLDER
    })

    const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [LOWER, UPPER])

    expect([...state.ancestry]).toEqual([[UPPER, false]])
  })

  it('attempts at most two fetches in one launch, however many SHAs are missing', async () => {
    git.findMergeBase.mockResolvedValue(undefined)
    git.fetchCommitSha.mockResolvedValue(false)
    const shas = [shaOf(1), shaOf(2), shaOf(3), shaOf(4)]

    const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, shas)

    expect(git.fetchCommitSha).toHaveBeenCalledTimes(2)
    expect(state.ancestry.size).toBe(0)
  })

  it('relates at most sixteen SHAs and leaves the rest unresolved', async () => {
    git.findMergeBase.mockResolvedValue(OLDER)
    const shas = Array.from({ length: 20 }, (_, i) => shaOf(i + 1))

    const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, shas)

    expect(git.findMergeBase).toHaveBeenCalledTimes(16)
    expect([...state.ancestry.keys()]).toEqual(shas.slice(0, 16))
  })

  it('stops relating SHAs once the launch is aborted', async () => {
    const abort = new AbortController()
    git.findMergeBase.mockImplementation(async () => {
      abort.abort()
      return OLDER
    })

    const state = await resolveCoreCommitState(
      REPO,
      { kind: 'head', commit: HEAD },
      [LOWER, UPPER],
      abort.signal
    )

    expect(git.findMergeBase).toHaveBeenCalledTimes(1)
    expect(state.ancestry.has(UPPER)).toBe(false)
  })

  it('trusts only a proven containment in a shallow clone', async () => {
    fs.writeFileSync(path.join(git.gitDir, 'shallow'), `${OLDER}\n`)
    git.findMergeBase.mockImplementation(async (_repo, sha) => (sha === LOWER ? LOWER : OLDER))

    const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [LOWER, UPPER])

    // A truncated graph can yield a different merge-base even when HEAD contains the SHA, so
    // "not contained" is unproven there; "contained" still rests on a local path.
    expect([...state.ancestry]).toEqual([[LOWER, true]])
  })
})
