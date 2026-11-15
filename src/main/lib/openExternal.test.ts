import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  app: { isPackaged: false },
  shell: { openExternal: vi.fn<(url: string) => Promise<void>>() }
}))

vi.mock('electron', () => electron)

import { getShellOpenExternalCalls, resetShellOpenExternalCalls } from './e2eOverrides'
import { isOpenableExternalUrl, openExternalUrl, tryOpenExternalUrl } from './openExternal'

const handedToTheOs = (): string[] => electron.shell.openExternal.mock.calls.map(([url]) => url)

beforeEach(() => {
  electron.app.isPackaged = false
  electron.shell.openExternal.mockReset()
  electron.shell.openExternal.mockResolvedValue()
  resetShellOpenExternalCalls()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('opening a link outside the app', () => {
  it.each([
    ['https://comfy.org/docs', 'https://comfy.org/docs'],
    ['http://127.0.0.1:8188/view?filename=a.png', 'http://127.0.0.1:8188/view?filename=a.png'],
    ['mailto:hello@comfy.org', 'mailto:hello@comfy.org'],
    ['  HTTPS://Comfy.org/a b\n', 'https://comfy.org/a%20b']
  ])('hands %j to the OS as %j', async (asked, opened) => {
    expect(await tryOpenExternalUrl(asked)).toBe(true)
    expect(handedToTheOs()).toEqual([opened])
  })

  it.each([
    'file:///etc/passwd',
    'FILE:///C:/Windows/System32/calc.exe',
    'file://attacker.example/share/payload.exe',
    ' \tfile:///etc/passwd',
    'fi\nle:///etc/passwd',
    'smb://attacker.example/share',
    'search-ms:query=invoice&crumb=location:%5C%5Cattacker.example%5Cshare',
    'ms-msdt:/id PCWDiagnostic',
    'vscode://file/etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:http://127.0.0.1:8188/0b0e7a2e',
    'about:blank',
    'C:\\Users\\me\\Downloads\\run.bat',
    '\\\\attacker.example\\share\\payload.exe',
    '/Applications/Calculator.app',
    'comfy.org',
    ''
  ])('hands nothing to the OS for %j', async (asked) => {
    expect(isOpenableExternalUrl(asked)).toBe(false)
    expect(await tryOpenExternalUrl(asked)).toBe(false)
    await expect(openExternalUrl(asked)).rejects.toThrow(/not http, https or mailto/)
    expect(handedToTheOs()).toEqual([])
  })

  it.each([undefined, null, 42, { href: 'https://comfy.org/' }])(
    'hands nothing to the OS for the non-string %j',
    async (asked) => {
      expect(await tryOpenExternalUrl(asked)).toBe(false)
      expect(handedToTheOs()).toEqual([])
    }
  )

  it('reports a link the OS could not open', async () => {
    electron.shell.openExternal.mockRejectedValue(new Error('no handler'))

    expect(await tryOpenExternalUrl('https://comfy.org/')).toBe(false)
    await expect(openExternalUrl('https://comfy.org/')).rejects.toThrow('no handler')
  })

  it('records the link for an E2E run of an unpackaged build and opens nothing', async () => {
    vi.stubEnv('E2E', '1')

    expect(await tryOpenExternalUrl('https://comfy.org/docs')).toBe(true)
    expect(await tryOpenExternalUrl('file:///etc/passwd')).toBe(false)

    expect(getShellOpenExternalCalls()).toEqual(['https://comfy.org/docs'])
    expect(handedToTheOs()).toEqual([])
  })

  it('opens the link in a packaged build even when the E2E variable is set', async () => {
    vi.stubEnv('E2E', '1')
    electron.app.isPackaged = true

    expect(await tryOpenExternalUrl('https://comfy.org/docs')).toBe(true)

    expect(handedToTheOs()).toEqual(['https://comfy.org/docs'])
  })
})
