import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const git = vi.hoisted(() => ({
  findMergeBase: vi.fn<(repo: string, a: string, b: string) => Promise<string | undefined>>(),
  fetchCommitSha: vi.fn<(repo: string, sha: string) => Promise<boolean>>(),
  revParseRef: vi.fn<(repo: string, ref: string) => Promise<string | undefined>>(),
  gitDir: '',
  configDir: '',
  presence: undefined as undefined | 'present' | 'absent' | 'unknown',
  noCommonAncestor: false
}))
vi.mock('./git', () => ({
  findMergeBase: (...args: [string, string, string]) => git.findMergeBase(...args),
  findMergeBaseOrNone: async (...args: [string, string, string]) =>
    git.noCommonAncestor ? null : git.findMergeBase(...args),
  fetchCommitSha: (...args: [string, string]) => git.fetchCommitSha(...args),
  resolveGitDir: () => git.gitDir,
  revParseRef: (...args: [string, string]) => git.revParseRef(...args),
  // A definite miss unless the rev-parse mock resolves it; `presence` overrides per test.
  commitPresence: async (repo: string, sha: string) =>
    git.presence ?? ((await git.revParseRef(repo, `${sha}^{commit}`)) ? 'present' : 'absent')
}))
vi.mock('./paths', () => ({ configDir: () => git.configDir }))
vi.mock('./telemetry', () => ({ getOpsFlagResult: vi.fn() }))

import { _backgroundFetchesForTest, resolveCoreCommitState } from './coreBetaAncestry'
import { NO_CORE_COMMITS } from './coreBetaGrants'

const REPO = '/installs/comfy/ComfyUI'
const HEAD = 'e'.repeat(40)
const LOWER = 'a'.repeat(40)
const UPPER = 'b'.repeat(40)
const OLDER = 'f'.repeat(40)

beforeEach(() => {
  git.gitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-beta-gitdir-'))
  git.configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'core-beta-config-'))
  git.findMergeBase.mockReset()
  git.fetchCommitSha.mockReset()
  // Default: HEAD resolves (the repository is readable) and no other SHA exists locally.
  git.presence = undefined
  git.noCommonAncestor = false
  git.revParseRef.mockReset()
  git.revParseRef.mockImplementation(async (_repo, ref) =>
    ref === `${HEAD}^{commit}` ? HEAD : undefined
  )
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  await _backgroundFetchesForTest()
  fs.rmSync(git.gitDir, { recursive: true, force: true })
  fs.rmSync(git.configDir, { recursive: true, force: true })
})

const makeShallow = (): void =>
  fs.writeFileSync(path.join(git.gitDir, 'shallow'), `${'c'.repeat(40)}\n`)

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

  describe('a SHA the checkout lacks', () => {
    beforeEach(() => {
      git.findMergeBase.mockResolvedValue(undefined)
    })

    it('is not contained on a full clone, with no fetch', async () => {
      const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [UPPER])

      expect(state.ancestry.get(UPPER), 'a full clone holds every ancestor of HEAD').toBe(false)
      expect(git.fetchCommitSha).not.toHaveBeenCalled()
    })

    it('stays unresolved when HEAD itself does not resolve, so absence proves nothing', async () => {
      git.revParseRef.mockResolvedValue(undefined)

      const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [UPPER])

      expect(state.ancestry.has(UPPER)).toBe(false)
      expect(git.fetchCommitSha).not.toHaveBeenCalled()
    })

    it('stays unresolved, with no fetch, when it is present but unrelated', async () => {
      git.revParseRef.mockImplementation(async (_repo, ref) => ref.slice(0, 40))

      const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [UPPER])

      expect(state.ancestry.has(UPPER)).toBe(false)
      expect(git.fetchCommitSha).not.toHaveBeenCalled()
    })

    it('is fetched in the background on a shallow clone, and is unresolved for this launch', async () => {
      makeShallow()
      let release!: (ok: boolean) => void
      git.fetchCommitSha.mockImplementation(() => new Promise((resolve) => (release = resolve)))

      const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [UPPER])

      expect(state.ancestry.has(UPPER), 'the launch did not wait for the fetch').toBe(false)
      expect(git.fetchCommitSha).toHaveBeenCalledExactlyOnceWith(REPO, UPPER)
      release(true)
    })

    it('starts at most two background fetches in one launch', async () => {
      makeShallow()
      git.fetchCommitSha.mockResolvedValue(true)

      await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [
        shaOf(1),
        shaOf(2),
        shaOf(3),
        shaOf(4)
      ])
      await _backgroundFetchesForTest()

      expect(git.fetchCommitSha).toHaveBeenCalledTimes(2)
    })

    describe('after a failed fetch', () => {
      beforeEach(async () => {
        makeShallow()
        git.fetchCommitSha.mockResolvedValue(false)
        await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [UPPER])
        await _backgroundFetchesForTest()
        git.fetchCommitSha.mockClear()
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      it('logs the outcome and skips the fetch on later launches', async () => {
        const lines = vi.mocked(console.log).mock.calls.map((call) => String(call[0]))
        expect(
          lines.some((l) =>
            /^\[core-beta\] fetch bbbbbbbbbbbb from origin: failed in \d+ms$/.test(l)
          )
        ).toBe(true)

        await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [UPPER])

        expect(git.fetchCommitSha).not.toHaveBeenCalled()
        const after = vi.mocked(console.log).mock.calls.map((call) => String(call[0]))
        expect(
          after.some((l) => l.startsWith('[core-beta] fetch bbbbbbbbbbbb: skipped, failed at '))
        ).toBe(true)
      })

      it('remembers the failure on disk, across a process restart', async () => {
        const stored = JSON.parse(
          fs.readFileSync(path.join(git.configDir, 'core-beta-fetch-failures.json'), 'utf-8')
        ) as Record<string, { head: string; failed: Record<string, number> }>
        expect(stored[REPO]?.head).toBe(HEAD)
        expect(Object.keys(stored[REPO]!.failed)).toEqual([UPPER])
      })

      it('retries once the HEAD has changed', async () => {
        const moved = '9'.repeat(40)
        git.revParseRef.mockImplementation(async (_repo, ref) =>
          ref === `${moved}^{commit}` ? moved : undefined
        )

        await resolveCoreCommitState(REPO, { kind: 'head', commit: moved }, [UPPER])

        expect(git.fetchCommitSha).toHaveBeenCalledOnce()
      })

      it('retries after a day', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1)

        await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [UPPER])

        expect(git.fetchCommitSha).toHaveBeenCalledOnce()
      })
    })
  })

  it('contains a throw to the one SHA and still relates the rest', async () => {
    git.findMergeBase.mockImplementation(async (_repo, sha) => {
      if (sha === LOWER) throw new Error('spawn EACCES')
      return OLDER
    })

    const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [LOWER, UPPER])

    expect([...state.ancestry]).toEqual([[UPPER, false]])
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

  describe('in a shallow clone', () => {
    const GRAFT = 'c'.repeat(40)
    const OTHER_GRAFT = 'd'.repeat(40)

    /** HEAD contains LOWER; UPPER is not reachable from HEAD (merge-base OLDER). `graftsBelowUpper`
     *  names the grafts the local graph shows to be ancestors of UPPER. */
    function graph(graftsBelowUpper: readonly string[]): void {
      git.findMergeBase.mockImplementation(async (_repo, a, b) => {
        if (b === UPPER && graftsBelowUpper.includes(a)) return a
        if (b === UPPER) return OLDER
        return a === LOWER ? LOWER : OLDER
      })
    }

    const shallowFile = (...lines: string[]): void =>
      fs.writeFileSync(path.join(git.gitDir, 'shallow'), lines.map((l) => `${l}\n`).join(''))

    const resolve = () =>
      resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [LOWER, UPPER])

    it('trusts "not contained" when every graft is an ancestor of the SHA', async () => {
      shallowFile(GRAFT, OTHER_GRAFT)
      graph([GRAFT, OTHER_GRAFT])

      expect([...(await resolve()).ancestry]).toEqual([
        [LOWER, true],
        [UPPER, false]
      ])
    })

    it('leaves "not contained" unresolved when any graft is not an ancestor of the SHA', async () => {
      shallowFile(GRAFT, OTHER_GRAFT)
      graph([GRAFT])

      expect(
        [...(await resolve()).ancestry],
        'a path below the unrelated graft could still reach the SHA'
      ).toEqual([[LOWER, true]])
    })

    it('leaves "not contained" unresolved when the shallow file cannot be parsed', async () => {
      shallowFile('not-a-sha')
      graph([GRAFT])

      expect([...(await resolve()).ancestry]).toEqual([[LOWER, true]])
    })

    it('leaves "not contained" unresolved past the graft cap rather than walking them all', async () => {
      const grafts = Array.from({ length: 9 }, (_, i) => shaOf(100 + i))
      shallowFile(...grafts)
      graph(grafts)

      expect([...(await resolve()).ancestry]).toEqual([[LOWER, true]])
    })

    it('trusts "contained" regardless of the grafts', async () => {
      shallowFile(GRAFT)
      graph([])

      expect((await resolve()).ancestry.get(LOWER)).toBe(true)
    })
  })

  describe('defensive input and repository handling', () => {
    beforeEach(() => {
      git.findMergeBase.mockResolvedValue(undefined)
    })

    it('reads the shallow marker from the common dir of a linked worktree', async () => {
      const common = fs.mkdtempSync(path.join(os.tmpdir(), 'core-beta-common-'))
      fs.writeFileSync(path.join(common, 'shallow'), `${'c'.repeat(40)}\n`)
      fs.writeFileSync(path.join(git.gitDir, 'commondir'), common)
      git.fetchCommitSha.mockResolvedValue(false)

      const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [UPPER])

      expect(
        state.ancestry.has(UPPER),
        'a shallow worktree must not read as a full clone, whose absence would prove "not contained"'
      ).toBe(false)
      fs.rmSync(common, { recursive: true, force: true })
    })

    it('treats a shallow marker it cannot stat as unknown, not as a full clone', async () => {
      const notADir = path.join(git.gitDir, 'plain-file')
      fs.writeFileSync(notADir, '')
      fs.writeFileSync(path.join(git.gitDir, 'commondir'), notADir)
      git.fetchCommitSha.mockResolvedValue(false)

      const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [UPPER])

      expect(state.ancestry.has(UPPER), 'ENOTDIR is "could not look", not absence').toBe(false)
    })

    it('normalizes SHA case and never hands git anything but a full SHA', async () => {
      const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [
        UPPER.toUpperCase(),
        '--upload-pack=touch /tmp/pwned',
        'abc123'
      ])

      expect([...state.ancestry]).toEqual([[UPPER, false]])
      for (const call of [...git.findMergeBase.mock.calls, ...git.revParseRef.mock.calls]) {
        expect(call.slice(1).join(' ')).not.toContain('--')
      }
      expect(git.fetchCommitSha).not.toHaveBeenCalled()
    })

    it('stops relating SHAs once the launch budget is spent', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      git.findMergeBase.mockImplementation(async () => {
        vi.setSystemTime(Date.now() + 11_000)
        return OLDER
      })

      const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [
        LOWER,
        UPPER
      ])

      expect([...state.ancestry.keys()], 'the second SHA is left unresolved').toEqual([LOWER])
      vi.useRealTimers()
    })

    it('re-reads the shallow boundaries for each SHA', async () => {
      git.findMergeBase.mockImplementation(async (_repo, sha) => {
        if (sha === LOWER) makeShallow()
        return undefined
      })
      git.fetchCommitSha.mockResolvedValue(false)

      const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [
        LOWER,
        UPPER
      ])

      expect(state.ancestry.get(LOWER), 'still a full clone when LOWER was checked').toBe(false)
      expect(state.ancestry.has(UPPER), 'shallow by the time UPPER was checked').toBe(false)
    })
  })

  describe('review follow-ups', () => {
    beforeEach(() => {
      git.findMergeBase.mockResolvedValue(undefined)
    })

    it('does not read a failed presence lookup as absence on a full clone', async () => {
      git.presence = 'unknown'

      const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [UPPER])

      expect(state.ancestry.has(UPPER), 'unknown must not become "not contained"').toBe(false)
    })

    it('returns when the budget runs out even if a git call never finishes', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      git.findMergeBase.mockImplementation(() => new Promise(() => {}))

      const pending = resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [LOWER])
      await vi.advanceTimersByTimeAsync(10_000)
      const state = await pending

      expect(state.ancestry.size).toBe(0)
      vi.useRealTimers()
    })

    it('returns as soon as the launch is aborted, mid git call', async () => {
      const abort = new AbortController()
      git.findMergeBase.mockImplementation(() => {
        abort.abort()
        return new Promise(() => {})
      })

      const state = await resolveCoreCommitState(
        REPO,
        { kind: 'head', commit: HEAD },
        [LOWER],
        abort.signal
      )

      expect(state.ancestry.size).toBe(0)
    })

    it('spends the fetch budget only on fetches that start', async () => {
      makeShallow()
      const recent = Date.now()
      fs.writeFileSync(
        path.join(git.configDir, 'core-beta-fetch-failures.json'),
        JSON.stringify({
          [REPO]: { head: HEAD, failed: { [shaOf(1)]: recent, [shaOf(2)]: recent } }
        })
      )
      git.fetchCommitSha.mockResolvedValue(true)

      await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [
        shaOf(1),
        shaOf(2),
        shaOf(3)
      ])
      await _backgroundFetchesForTest()

      expect(
        git.fetchCommitSha,
        'the two skips must not use up the budget'
      ).toHaveBeenCalledExactlyOnceWith(REPO, shaOf(3))
    })
  })

  describe('human review follow-ups', () => {
    it('proves "not contained" for a commit with no common ancestor on a full clone', async () => {
      git.noCommonAncestor = true
      // Present, so only the no-common-ancestor answer (not the absence rule) can prove it.
      git.presence = 'present'

      const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [UPPER])

      expect(state.ancestry.get(UPPER)).toBe(false)
      expect(git.fetchCommitSha).not.toHaveBeenCalled()
    })

    it('leaves no-common-ancestor unresolved on a shallow clone, whose graph may be cut short', async () => {
      makeShallow()
      git.noCommonAncestor = true
      git.revParseRef.mockImplementation(async (_repo, ref) => ref.slice(0, 40))

      const state = await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, [UPPER])

      expect(state.ancestry.has(UPPER)).toBe(false)
    })

    it('says a SHA past the resolution cap was not checked, rather than unprovable', async () => {
      git.findMergeBase.mockResolvedValue(OLDER)
      const shas = Array.from({ length: 17 }, (_, i) => shaOf(i + 1))

      await resolveCoreCommitState(REPO, { kind: 'head', commit: HEAD }, shas)

      const lines = vi.mocked(console.log).mock.calls.map((c) => String(c[0]))
      expect(lines).toContain(
        `[core-beta] ancestry ${shaOf(17).slice(0, 12)}: not checked (the payload names more than 16 commits), so entries that need it do not match`
      )
    })
  })
})
