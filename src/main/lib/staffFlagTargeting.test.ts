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

const { initStaffFlagTargeting, refreshStaffFlagTargeting, isStaffEmail, _resetForTest } =
  await import('./staffFlagTargeting')

/** Stub WebContents whose page-context read resolves to a fixed email (or rejects). */
function stubContents(result: unknown, opts: { throws?: boolean } = {}): Electron.WebContents {
  return {
    executeJavaScript: () =>
      opts.throws ? Promise.reject(new Error('page gone')) : Promise.resolve(result)
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

describe('isStaffEmail', () => {
  it.each([
    ['a plain staff address', 'someone@comfy.org', true],
    ['mixed case', 'Foo@Comfy.Org', true],
    ['surrounding whitespace', '  foo@comfy.org  ', true],
    ['both at once', '  Staff.Person@COMFY.ORG ', true],
    ['a non-staff address', 'someone@example.com', false],
    ['a lookalike domain', 'someone@notcomfy.org', false],
    ['the domain in the local part', 'comfy.org@example.com', false],
    ['an empty string', '', false],
    ['null', null, false],
    ['undefined', undefined, false]
  ])('classifies %s', (_label, email, expected) => {
    expect(isStaffEmail(email as string | null | undefined)).toBe(expected)
  })

  it('rejects a non-string without throwing', () => {
    expect(isStaffEmail(42 as unknown as string)).toBe(false)
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
    await refreshStaffFlagTargeting(stubContents('someone@comfy.org'))

    expect(storedFile()).toMatchObject({ staff: true })
  })

  it('stores only a boolean — never the address it classified', async () => {
    // The whole privacy argument: an address is classified in page context and discarded, so
    // there is no path by which one could reach disk or PostHog.
    await refreshStaffFlagTargeting(stubContents('someone@comfy.org'))

    expect(fs.readFileSync(persistFilePath(), 'utf-8')).not.toContain('someone@comfy.org')
    expect(fs.readFileSync(persistFilePath(), 'utf-8')).not.toContain('comfy.org')
  })

  it('never hands telemetry anything but a boolean', async () => {
    await refreshStaffFlagTargeting(stubContents('someone@comfy.org'))

    for (const [arg] of setFlagEvaluationStaff.mock.calls) {
      expect(typeof arg).toBe('boolean')
    }
  })

  it('carries a staff classification into the next launch', async () => {
    // The behaviour the whole design exists to produce, end to end across a restart: sign in on
    // one launch, be targeted on the next.
    await refreshStaffFlagTargeting(stubContents('someone@comfy.org'))

    expect(nextLaunchBinding()).toBe(true)
  })

  it('does not target the launch it runs on', async () => {
    // The accepted cost, pinned: the boot evaluation has already gone out by the time a view
    // resolves auth, and this deliberately does not try to redo it.
    initStaffFlagTargeting()
    expect(setFlagEvaluationStaff).toHaveBeenLastCalledWith(false)

    await refreshStaffFlagTargeting(stubContents('someone@comfy.org'))

    expect(storedFile()).toMatchObject({ staff: true })
  })

  it('stores false for a non-staff account', async () => {
    await refreshStaffFlagTargeting(stubContents('someone@example.com'))

    expect(storedFile()).toMatchObject({ staff: false })
    expect(nextLaunchBinding()).toBe(false)
  })

  it('reclassifies to false on sign-out, so a machine that changes hands stops presenting as staff', async () => {
    await refreshStaffFlagTargeting(stubContents('someone@comfy.org'))
    expect(nextLaunchBinding()).toBe(true)

    await refreshStaffFlagTargeting(stubContents(null))

    expect(storedFile()).toMatchObject({ staff: false })
    expect(nextLaunchBinding()).toBe(false)
  })

  it('reclassifies on a switch to a non-staff account', async () => {
    await refreshStaffFlagTargeting(stubContents('first@comfy.org'))

    await refreshStaffFlagTargeting(stubContents('second@example.com'))

    expect(nextLaunchBinding()).toBe(false)
  })

  it('does not rewrite the file when the classification is unchanged', async () => {
    // Every page load reaches here, so "no change" has to cost nothing.
    await refreshStaffFlagTargeting(stubContents('someone@comfy.org'))
    const firstWrite = fs.statSync(persistFilePath()).mtimeMs

    await refreshStaffFlagTargeting(stubContents('someone@comfy.org'))
    await refreshStaffFlagTargeting(stubContents('another@comfy.org'))

    expect(fs.statSync(persistFilePath()).mtimeMs).toBe(firstWrite)
  })

  it('binds the classification immediately as well as storing it', async () => {
    await refreshStaffFlagTargeting(stubContents('someone@comfy.org'))

    expect(setFlagEvaluationStaff).toHaveBeenLastCalledWith(true)
  })

  it('survives a page-context read that throws, leaving the stored value alone', async () => {
    // Fire-and-forget from `attach.ts`; an escaping rejection would be unhandled. A page that
    // cannot be read must not revoke a grant.
    await refreshStaffFlagTargeting(stubContents('someone@comfy.org'))

    await expect(
      refreshStaffFlagTargeting(stubContents(null, { throws: true }))
    ).resolves.toBeUndefined()
    expect(nextLaunchBinding()).toBe(true)
  })

  it('treats a non-string page value as not signed in', async () => {
    await refreshStaffFlagTargeting(stubContents({ email: 'someone@comfy.org' }))

    expect(storedFile()).toMatchObject({ staff: false })
  })

  it('survives an unwritable config dir', async () => {
    fs.rmSync(testConfigDir, { recursive: true, force: true })

    await expect(
      refreshStaffFlagTargeting(stubContents('someone@comfy.org'))
    ).resolves.toBeUndefined()
  })
})
