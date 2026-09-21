// Classifying the signed-in account for ops-flag person targeting, and carrying that
// classification to the next launch.
//
// The boot flag evaluation is the only authoritative one, so what matters here is that the
// stored answer is bound BEFORE it and that the stored answer is a boolean and nothing else.
// Whether the property may leave the process is telemetry's gate (`telemetry.test.ts`).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

let testConfigDir = ''
vi.mock('./paths', () => ({
  configDir: () => testConfigDir
}))

const setFlagEvaluationStaff = vi.fn()
vi.mock('./telemetry', () => ({
  setFlagEvaluationStaff: (isStaff: boolean) => setFlagEvaluationStaff(isStaff)
}))

const { initStaffFlagTargeting, refreshStaffFlagTargeting, CLASSIFY_STAFF_JS, _resetForTest } =
  await import('./staffFlagTargeting')

/** A view that CAN classify — it reached an auth store and reached a verdict. */
function stubContents(staff: boolean, opts: { throws?: boolean } = {}): Electron.WebContents {
  return {
    executeJavaScript: () =>
      opts.throws ? Promise.reject(new Error('page gone')) : Promise.resolve({ known: true, staff })
  } as unknown as Electron.WebContents
}

/** A view with NO auth store — it has no opinion about who is signed in. */
function stubContentsWithoutAuthStore(): Electron.WebContents {
  return {
    executeJavaScript: () => Promise.resolve({ known: false })
  } as unknown as Electron.WebContents
}

/** A view whose read returns something unexpected entirely. */
function stubContentsReturning(result: unknown): Electron.WebContents {
  return {
    executeJavaScript: () => Promise.resolve(result)
  } as unknown as Electron.WebContents
}

function persistFilePath(): string {
  return path.join(testConfigDir, 'staff-targeting.json')
}

function storedFile(): unknown {
  return JSON.parse(fs.readFileSync(persistFilePath(), 'utf-8'))
}

/** What the boot evaluation would be told on the NEXT launch: a fresh process reads the file
 *  this one left behind. */
function nextLaunchBinding(): boolean {
  setFlagEvaluationStaff.mockClear()
  _resetForTest()
  initStaffFlagTargeting()
  return setFlagEvaluationStaff.mock.calls.at(-1)?.[0] as boolean
}

beforeEach(() => {
  testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-targeting-'))
  setFlagEvaluationStaff.mockClear()
  _resetForTest()
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(testConfigDir, { recursive: true, force: true })
})

/** Minimal IndexedDB good enough for `CLASSIFY_STAFF_JS`. Handlers are attached after `open()`
 *  returns, exactly as in a browser, so every callback fires on a later microtask. */
function fakeIndexedDB(opts: {
  databases?: { name: string }[]
  stores?: string[]
  entries?: unknown[]
  openOutcome?: 'success' | 'error' | 'blocked' | 'never'
}) {
  const closed = { count: 0 }
  const db = {
    objectStoreNames: {
      contains: (n: string) => (opts.stores ?? ['firebaseLocalStorage']).includes(n)
    },
    transaction: () => ({
      objectStore: () => ({
        getAll: () => {
          const req: Record<string, unknown> = { result: opts.entries ?? [] }
          queueMicrotask(() => (req['onsuccess'] as (() => void) | undefined)?.())
          return req
        }
      })
    }),
    close: () => {
      closed.count += 1
    }
  }
  const idb = {
    databases: () => Promise.resolve(opts.databases ?? [{ name: 'firebaseLocalStorageDb' }]),
    open: () => {
      const req: Record<string, unknown> = { result: db, error: new Error('open failed') }
      const outcome = opts.openOutcome ?? 'success'
      if (outcome !== 'never') {
        queueMicrotask(() => {
          const handler = { success: 'onsuccess', error: 'onerror', blocked: 'onblocked' }[outcome]
          ;(req[handler] as (() => void) | undefined)?.()
        })
      }
      return req
    }
  }
  return { idb, closed }
}

/** A stored Firebase auth record. */
function authRecord(uid: string, email: string | null, emailVerified = true): unknown {
  return { fbase_key: `firebase:authUser:key:${uid}`, value: { uid, email, emailVerified } }
}

/** Run the REAL injected script against a stubbed IndexedDB. */
async function classify(opts: Parameters<typeof fakeIndexedDB>[0]): Promise<{
  result: { known?: boolean; staff?: boolean }
  closed: number
}> {
  const { idb, closed } = fakeIndexedDB(opts)
  const run = new Function('indexedDB', 'setTimeout', `return ${CLASSIFY_STAFF_JS}`) as (
    i: unknown,
    t: unknown
  ) => Promise<{ known?: boolean; staff?: boolean }>
  const result = await run(idb, setTimeout)
  return { result, closed: closed.count }
}

// The cohort rule lives in the injected script, so it is tested there rather than through a
// main-process stand-in that could agree with a mistake.
describe('CLASSIFY_STAFF_JS', () => {
  it.each([
    ['a plain staff address', 'someone@comfy.org', true],
    ['mixed case', 'Foo@Comfy.Org', true],
    ['surrounding whitespace', '  foo@comfy.org  ', true],
    ['both at once', '  Staff.Person@COMFY.ORG ', true],
    ['a non-staff address', 'someone@example.com', false],
    ['a lookalike domain', 'someone@notcomfy.org', false],
    ['the domain in the local part', 'comfy.org@example.com', false],
    ['an empty address', '', false],
    ['a null address', null, false]
  ])('classifies %s', async (_label, email, expected) => {
    const { result } = await classify({ entries: [authRecord('u1', email as string | null)] })

    expect(result).toEqual({ known: true, staff: expected })
  })

  it('refuses an unverified address, which proves nothing about domain ownership', async () => {
    // Firebase email/password sign-up accepts any address, so an unverified `@comfy.org` one is
    // self-asserted. Without this check anyone could sign up and enter the cohort.
    const { result } = await classify({ entries: [authRecord('u1', 'someone@comfy.org', false)] })

    expect(result).toEqual({ known: true, staff: false })
  })

  it('reports signed out when no auth record exists', async () => {
    const { result } = await classify({ entries: [] })

    expect(result).toEqual({ known: true, staff: false })
  })

  it('declines to answer when two accounts are stored', async () => {
    // Taking the first would make the answer depend on iteration order, and a stale record for a
    // former staff account would classify a current non-staff session as staff.
    const { result } = await classify({
      entries: [authRecord('u1', 'someone@comfy.org'), authRecord('u2', 'other@example.com')]
    })

    expect(result).toEqual({ known: false })
  })

  it('still answers when one account is stored under duplicate keys', async () => {
    const { result } = await classify({
      entries: [authRecord('u1', 'someone@comfy.org'), authRecord('u1', 'someone@comfy.org')]
    })

    expect(result).toEqual({ known: true, staff: true })
  })

  it.each([['__proto__'], ['constructor'], ['toString']])(
    'counts a record whose uid is %s, so the one-account guard cannot be slipped past',
    async (uid) => {
      // On a plain object these keys are truthy before any record is seen, so such a record
      // would be skipped, leaving one survivor and passing the "exactly one account" check on
      // a two-account state.
      const { result } = await classify({
        entries: [authRecord('real', 'someone@comfy.org'), authRecord(uid, 'other@example.com')]
      })

      expect(result).toEqual({ known: false })
    }
  )

  it.each([
    ['there is no Firebase database', { databases: [] }],
    ['the object store is missing', { stores: [] }],
    ['the open fails', { openOutcome: 'error' as const }],
    ['the open is blocked', { openOutcome: 'blocked' as const }]
  ])('declines to answer when %s', async (_label, opts) => {
    // None of these is evidence of being signed out, so none may vote "not staff".
    const { result } = await classify(opts)

    expect(result).toEqual({ known: false })
  })

  it('ignores entries that are not auth records', async () => {
    const { result } = await classify({
      entries: [{ fbase_key: 'something:else', value: { uid: 'x', email: 'a@comfy.org' } }, null]
    })

    expect(result).toEqual({ known: true, staff: false })
  })

  it('gives up on an open that never settles, rather than hanging forever', async () => {
    // `executeJavaScript` has no timeout, so without the bounded wait the awaiting main-process
    // promise never settles and leaks a `WebContents` reference per page load.
    vi.useFakeTimers()
    try {
      const pending = classify({ openOutcome: 'never' })
      await vi.advanceTimersByTimeAsync(5000)
      const { result } = await pending

      expect(result).toEqual({ known: false })
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes the database even when it answers nothing', async () => {
    // A leaked connection blocks a later Firebase `versionchange`.
    const { closed } = await classify({ stores: [] })

    expect(closed).toBe(1)
  })

  it('never returns the address itself', async () => {
    // The privacy claim, pinned at the boundary it is made about.
    const { result } = await classify({ entries: [authRecord('u1', 'someone@comfy.org')] })

    expect(JSON.stringify(result)).not.toContain('comfy.org')
  })
})

describe('initStaffFlagTargeting', () => {
  it('binds false when nothing has been stored yet', () => {
    initStaffFlagTargeting()

    expect(setFlagEvaluationStaff).toHaveBeenCalledWith(false)
  })

  it.each([
    ['corrupt JSON', '{not json'],
    ['a non-object', '"staff"'],
    ['an array', '[true]'],
    ['a missing key', '{}'],
    ['a non-boolean value', '{"staff":"true"}']
  ])('binds false for %s, failing to the safe direction', (_label, contents) => {
    // The file is user-writable JSON on disk, so every failure mode has to read as "not staff"
    // rather than throwing or granting.
    fs.writeFileSync(persistFilePath(), contents, 'utf-8')

    initStaffFlagTargeting()

    expect(setFlagEvaluationStaff).toHaveBeenCalledWith(false)
  })

  it('binds true for a stored staff classification', () => {
    fs.writeFileSync(persistFilePath(), JSON.stringify({ staff: true }), 'utf-8')

    initStaffFlagTargeting()

    expect(setFlagEvaluationStaff).toHaveBeenCalledWith(true)
  })
})

describe('refreshStaffFlagTargeting', () => {
  it('stores the classification for the next launch', async () => {
    await refreshStaffFlagTargeting(stubContents(true))

    expect(storedFile()).toMatchObject({ staff: true })
  })

  it('stores only a boolean — never the address it classified', async () => {
    // The whole privacy argument: an address is classified in page context and discarded, so
    // there is no path by which one could reach disk or PostHog.
    await refreshStaffFlagTargeting(stubContents(true))

    expect(fs.readFileSync(persistFilePath(), 'utf-8')).not.toContain('someone@comfy.org')
    expect(fs.readFileSync(persistFilePath(), 'utf-8')).not.toContain('comfy.org')
  })

  it('never hands telemetry anything but a boolean', async () => {
    await refreshStaffFlagTargeting(stubContents(true))

    for (const [arg] of setFlagEvaluationStaff.mock.calls) {
      expect(typeof arg).toBe('boolean')
    }
  })

  it('carries a staff classification into the next launch', async () => {
    // The behaviour the whole design exists to produce, end to end across a restart: sign in on
    // one launch, be targeted on the next.
    await refreshStaffFlagTargeting(stubContents(true))

    expect(nextLaunchBinding()).toBe(true)
  })

  it('does not target the launch it runs on', async () => {
    // The accepted cost, pinned: the boot evaluation has already gone out by the time a view
    // resolves auth, and this deliberately does not try to redo it.
    initStaffFlagTargeting()
    expect(setFlagEvaluationStaff).toHaveBeenLastCalledWith(false)

    await refreshStaffFlagTargeting(stubContents(true))

    expect(storedFile()).toMatchObject({ staff: true })
  })

  it('stores false for a non-staff account', async () => {
    await refreshStaffFlagTargeting(stubContents(false))

    expect(storedFile()).toMatchObject({ staff: false })
    expect(nextLaunchBinding()).toBe(false)
  })

  it('reclassifies to false on sign-out, so a machine that changes hands stops presenting as staff', async () => {
    await refreshStaffFlagTargeting(stubContents(true))
    expect(nextLaunchBinding()).toBe(true)

    await refreshStaffFlagTargeting(stubContents(false))

    expect(storedFile()).toMatchObject({ staff: false })
    expect(nextLaunchBinding()).toBe(false)
  })

  it('reclassifies on a switch to a non-staff account', async () => {
    await refreshStaffFlagTargeting(stubContents(true))

    await refreshStaffFlagTargeting(stubContents(false))

    expect(nextLaunchBinding()).toBe(false)
  })

  it('does not rewrite the file when the classification is unchanged', async () => {
    // Every page load reaches here, so "no change" has to cost nothing.
    await refreshStaffFlagTargeting(stubContents(true))
    const firstWrite = fs.statSync(persistFilePath()).mtimeMs

    await refreshStaffFlagTargeting(stubContents(true))
    await refreshStaffFlagTargeting(stubContents(true))

    expect(fs.statSync(persistFilePath()).mtimeMs).toBe(firstWrite)
  })

  it('binds the classification immediately as well as storing it', async () => {
    await refreshStaffFlagTargeting(stubContents(true))

    expect(setFlagEvaluationStaff).toHaveBeenLastCalledWith(true)
  })

  it('survives a page-context read that throws, leaving the stored value alone', async () => {
    // Fire-and-forget from `attach.ts`; an escaping rejection would be unhandled. A page that
    // cannot be read must not revoke a grant.
    await refreshStaffFlagTargeting(stubContents(true))

    await expect(
      refreshStaffFlagTargeting(stubContents(false, { throws: true }))
    ).resolves.toBeUndefined()
    expect(nextLaunchBinding()).toBe(true)
  })

  it('treats a non-boolean verdict as not staff', async () => {
    await refreshStaffFlagTargeting(stubContentsReturning({ known: true, staff: 'yes' }))

    expect(storedFile()).toMatchObject({ staff: false })
  })

  it.each([
    ['a view with no auth store', () => stubContentsWithoutAuthStore()],
    ['a read that returned null', () => stubContentsReturning(null)],
    ['a read that returned an unexpected shape', () => stubContentsReturning('nope')]
  ])('stays silent for %s rather than voting "not staff"', async (_label, make) => {
    // Absence of an auth record is not evidence of being signed out. A local install that was
    // never signed into must not clear a classification a signed-in view established — that
    // would be a wrong answer, not merely a racy one.
    await refreshStaffFlagTargeting(stubContents(true))
    expect(nextLaunchBinding()).toBe(true)

    await refreshStaffFlagTargeting(make())

    expect(nextLaunchBinding()).toBe(true)
  })

  it('retries the write on a later page load after a failure', async () => {
    // The cache moves only after a successful write. Moving it first would record a write that
    // never landed, and the unchanged-classification check would then suppress every later
    // attempt — leaving the next launch reading the stale value even once the disk recovered.
    //
    // The failure has to be REAL. Removing the config dir does not cause one: `writeFileSafe`
    // recreates the parent (`mkdirSync(dirname, {recursive: true})`), so the write would
    // succeed and this test would pass through the unchanged-classification path having proven
    // nothing. Blocking the staging path with a directory makes the rename fail for real.
    fs.mkdirSync(persistFilePath() + '.tmp', { recursive: true })
    await refreshStaffFlagTargeting(stubContents(true))
    expect(fs.existsSync(persistFilePath())).toBe(false)

    fs.rmSync(persistFilePath() + '.tmp', { recursive: true, force: true })
    await refreshStaffFlagTargeting(stubContents(true))

    expect(storedFile()).toMatchObject({ staff: true })
    expect(nextLaunchBinding()).toBe(true)
  })

  it('keeps writing after an unreadable stored file, rather than assuming not-staff', async () => {
    // An unreadable file is UNKNOWN, not absent. Folding it into `false` would leave the cache
    // disagreeing with a file that may hold `true`, and the unchanged-classification check would
    // then suppress the write a genuine sign-out needs to make.
    fs.writeFileSync(persistFilePath(), JSON.stringify({ staff: true }), 'utf-8')
    fs.chmodSync(persistFilePath(), 0o000)
    // `chmod 000` does not stop root, and does nothing on Windows. Without this the read would
    // succeed, the test would pass down the ordinary path, and the unreadable branch it claims
    // to cover would never run — a test that chmods and nods.
    let unreadable = false
    try {
      fs.readFileSync(persistFilePath())
    } catch {
      unreadable = true
    }
    if (!unreadable) {
      fs.chmodSync(persistFilePath(), 0o644)
      return
    }
    initStaffFlagTargeting()

    await refreshStaffFlagTargeting(stubContents(false))

    fs.chmodSync(persistFilePath(), 0o644)
    expect(storedFile()).toMatchObject({ staff: false })
  })

  it('survives an unwritable config dir', async () => {
    fs.rmSync(testConfigDir, { recursive: true, force: true })

    await expect(refreshStaffFlagTargeting(stubContents(true))).resolves.toBeUndefined()
  })
})
