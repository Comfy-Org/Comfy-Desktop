// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.hoisted(() => vi.fn())
const releaseMock = vi.hoisted(() => vi.fn(() => '10.0.26100'))
vi.mock('child_process', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  execFile: execFileMock
}))
vi.mock('os', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  release: releaseMock
}))

import { parsePolicyKeyListing, readSmartAppControlState } from './smartAppControl'

/** `reg query HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy` as Windows 11 prints it. */
function listing(stateLine: string | null): string {
  return [
    '',
    'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy',
    '    EmodePolicyRequired    REG_DWORD    0x0',
    ...(stateLine === null ? [] : [stateLine]),
    '    SkuPolicyRequired    REG_DWORD    0x0',
    ''
  ].join('\r\n')
}

describe('parsePolicyKeyListing', () => {
  it.each([
    ['0x0', 'off'],
    ['0x1', 'on'],
    ['0x2', 'evaluation']
  ] as const)('reads %s as %s', (dword, state) => {
    expect(
      parsePolicyKeyListing(listing(`    VerifiedAndReputablePolicyState    REG_DWORD    ${dword}`))
    ).toBe(state)
  })

  it('reads a key without the value as not_applicable', () => {
    expect(parsePolicyKeyListing(listing(null))).toBe('not_applicable')
  })

  it('reads an unrecognised value as unknown, never as off', () => {
    expect(
      parsePolicyKeyListing(listing('    VerifiedAndReputablePolicyState    REG_DWORD    0x7'))
    ).toBe('unknown')
    expect(
      parsePolicyKeyListing(listing('    VerifiedAndReputablePolicyState    REG_SZ    1'))
    ).toBe('unknown')
  })

  it('does not match a value whose name only starts with the state name', () => {
    expect(
      parsePolicyKeyListing(
        listing('    VerifiedAndReputablePolicyStateMinValueSeen    REG_DWORD    0x1')
      )
    ).toBe('not_applicable')
  })
})

describe('readSmartAppControlState', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!

  function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  }

  beforeEach(() => {
    execFileMock.mockReset()
    // Fail by default, so a test that should not read fails on its assertion, not a timeout.
    execFileMock.mockImplementation((_file, _args, _opts, cb) =>
      cb(new Error('unexpected'), '', '')
    )
    releaseMock.mockReturnValue('10.0.26100')
    setPlatform('win32')
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform)
  })

  it('reads the CI policy key with reg.exe from System32', async () => {
    execFileMock.mockImplementation((_file, _args, _opts, cb) =>
      cb(null, listing('    VerifiedAndReputablePolicyState    REG_DWORD    0x1'), '')
    )

    await expect(readSmartAppControlState()).resolves.toBe('on')
    const [file, args, opts] = execFileMock.mock.calls[0]!
    expect(String(file).toLowerCase()).toMatch(/system32[\\/]reg\.exe$/)
    expect(args).toEqual(['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\CI\\Policy'])
    expect(opts).toMatchObject({ timeout: 1000, windowsHide: true })
  })

  it('is unknown when reg.exe fails or times out', async () => {
    execFileMock.mockImplementation((_file, _args, _opts, cb) =>
      cb(Object.assign(new Error('timed out'), { killed: true }), '', '')
    )

    await expect(readSmartAppControlState()).resolves.toBe('unknown')
  })

  it('is unknown when spawning throws instead of calling back', async () => {
    execFileMock.mockImplementation(() => {
      throw new Error('spawn EINVAL')
    })

    await expect(readSmartAppControlState()).resolves.toBe('unknown')
  })

  it('settles as unknown when the child never calls back', async () => {
    vi.useFakeTimers()
    try {
      execFileMock.mockImplementation(() => undefined)
      const read = readSmartAppControlState()
      await vi.advanceTimersByTimeAsync(1500)
      await expect(read).resolves.toBe('unknown')
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to C:\\Windows when SystemRoot is unset', async () => {
    const original = process.env.SystemRoot
    delete process.env.SystemRoot
    try {
      await readSmartAppControlState()
    } finally {
      if (original !== undefined) process.env.SystemRoot = original
    }
    expect(String(execFileMock.mock.calls[0]![0])).toMatch(
      /^C:\\Windows[\\/]System32[\\/]reg\.exe$/
    )
  })

  it('finds reg.exe under SystemRoot', async () => {
    const original = process.env.SystemRoot
    process.env.SystemRoot = 'D:\\Win'
    try {
      await readSmartAppControlState()
    } finally {
      if (original === undefined) delete process.env.SystemRoot
      else process.env.SystemRoot = original
    }
    expect(String(execFileMock.mock.calls[0]![0])).toMatch(/^D:\\Win[\\/]System32[\\/]reg\.exe$/)
  })

  it.each(['darwin', 'linux'] as const)('is not_applicable on %s without reading', async (p) => {
    setPlatform(p)

    await expect(readSmartAppControlState()).resolves.toBe('not_applicable')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('is not_applicable before Windows 11 22H2 without reading', async () => {
    releaseMock.mockReturnValue('10.0.19045')

    await expect(readSmartAppControlState()).resolves.toBe('not_applicable')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('reads from Windows 11 22H2 on', async () => {
    releaseMock.mockReturnValue('10.0.22621')
    execFileMock.mockImplementation((_file, _args, _opts, cb) =>
      cb(null, listing('    VerifiedAndReputablePolicyState    REG_DWORD    0x0'), '')
    )

    await expect(readSmartAppControlState()).resolves.toBe('off')
  })
})
