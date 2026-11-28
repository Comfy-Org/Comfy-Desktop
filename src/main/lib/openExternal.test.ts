import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  app: { isPackaged: false },
  shell: { openExternal: vi.fn<(url: string) => Promise<void>>() }
}))

vi.mock('electron', () => electron)

import { getShellOpenExternalCalls, resetShellOpenExternalCalls } from './e2eOverrides'
import {
  isAgentApp,
  isOpenableExternalUrl,
  openAgentApp,
  openExternalUrl,
  tryOpenExternalUrl,
  tryOpenExternalUrlOrAgentApp
} from './openExternal'

const handedToTheOs = (): string[] => electron.shell.openExternal.mock.calls.map(([url]) => url)

beforeEach(() => {
  electron.app.isPackaged = false
  electron.shell.openExternal.mockReset()
  electron.shell.openExternal.mockResolvedValue()
  resetShellOpenExternalCalls()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
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

const LONG_PROMPT = 'Deploy "my workflow" & run it: 100% + émoji 🎨\nsecond line #2?'

describe('opening a link from a ComfyUI page', () => {
  it.each([
    ['claude://code/new?q=Deploy%20my%20workflow', 'claude://code/new?q=Deploy%20my%20workflow'],
    ['codex://new?prompt=Deploy%20my%20workflow', 'codex://new?prompt=Deploy%20my%20workflow'],
    ['claude://code/new?q=', 'claude://code/new?q='],
    ['CLAUDE://code/new?q=x', 'claude://code/new?q=x'],
    ['Codex://new?prompt=x', 'codex://new?prompt=x'],
    ['  claude://code/new?q=x\n', 'claude://code/new?q=x'],
    ['claude://code/new?q=a+b&', 'claude://code/new?q=a%20b'],
    ['codex://new?prompt=%3Cscript%3E%22%27%60', "codex://new?prompt=%3Cscript%3E%22'%60"],
    ['https://comfy.org/docs', 'https://comfy.org/docs'],
    ['mailto:hello@comfy.org', 'mailto:hello@comfy.org']
  ])('hands %j to the OS as %j', async (asked, opened) => {
    expect(await tryOpenExternalUrlOrAgentApp(asked)).toBe(true)
    expect(handedToTheOs()).toEqual([opened])
  })

  it.each([
    ['claude', `claude://code/new?q=${encodeURIComponent(LONG_PROMPT)}`],
    ['codex', `codex://new?prompt=${encodeURIComponent(LONG_PROMPT)}`]
  ])('hands the %s link the frontend builds to the OS unchanged', async (_app, link) => {
    expect(await tryOpenExternalUrlOrAgentApp(link)).toBe(true)
    expect(handedToTheOs()).toEqual([link])
  })

  it.each([
    'claude://CODE/new?q=x',
    'claude://code/NEW?q=x',
    'claude://code/new?Q=x',
    'codex://NEW?prompt=x',
    'claude://code/new',
    'claude://code/new?q=x&mode=auto',
    'claude://code/new?q=x&q=y',
    'claude://code/new?q=x#fragment',
    'claude://code/new/extra?q=x',
    'claude://settings/new?q=x',
    'claude://code:8080/new?q=x',
    'claude://user:secret@code/new?q=x',
    'claude:code/new?q=x',
    'codex://new/thread?prompt=x',
    'codex://settings?prompt=x',
    'codex://new?q=x',
    'claude-code://code/new?q=x',
    'vscode://file/etc/passwd',
    'javascript:claude://code/new?q=x',
    'file://code/new?q=x',
    'smb://attacker.example/share',
    ''
  ])('hands nothing to the OS for %j', async (asked) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await tryOpenExternalUrlOrAgentApp(asked)).toBe(false)
    expect(handedToTheOs()).toEqual([])
  })

  it('reports an agent app link the OS could not open', async () => {
    electron.shell.openExternal.mockRejectedValue(new Error('no handler'))

    expect(await tryOpenExternalUrlOrAgentApp('claude://code/new?q=x')).toBe(false)
  })

  it('records an agent app link for an E2E run of an unpackaged build and opens nothing', async () => {
    vi.stubEnv('E2E', '1')

    expect(await tryOpenExternalUrlOrAgentApp('codex://new?prompt=x')).toBe(true)

    expect(getShellOpenExternalCalls()).toEqual(['codex://new?prompt=x'])
    expect(handedToTheOs()).toEqual([])
  })
})

describe('agent app links everywhere else in the app', () => {
  it.each(['claude://code/new?q=x', 'codex://new?prompt=x'])(
    'hands nothing to the OS for %j',
    async (asked) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      expect(isOpenableExternalUrl(asked)).toBe(false)
      expect(await tryOpenExternalUrl(asked)).toBe(false)
      await expect(openExternalUrl(asked)).rejects.toThrow(/not http, https or mailto/)
      expect(handedToTheOs()).toEqual([])
    }
  )
})

describe('a refused link', () => {
  it.each([
    ['claude://settings/new?q=my%20secret%20prompt', 'claude:'],
    ['file:///Users/me/secret.txt', 'file:'],
    ['not a link with a secret', 'no scheme'],
    ['my-secret-prompt-as-a-scheme:x', 'long scheme']
  ])('is logged for %j by its scheme only, as %j', async (asked, scheme) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await tryOpenExternalUrlOrAgentApp(asked)).toBe(false)

    expect(warn.mock.calls).toEqual([[`Refused to hand the OS a link (${scheme}).`]])
  })

  it('is not logged when the link opens', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await tryOpenExternalUrlOrAgentApp('claude://code/new?q=x')
    await tryOpenExternalUrl('https://comfy.org/')

    expect(warn).not.toHaveBeenCalled()
  })
})

describe('starting an agent app from a prompt Desktop wrote', () => {
  it.each([
    ['claude', 'claude://code/new?q=Deploy%20%22my%20build%22%0Anow'],
    ['codex', 'codex://new?prompt=Deploy%20%22my%20build%22%0Anow']
  ] as const)('hands the %s link to the OS with the prompt in it', async (app, opened) => {
    await openAgentApp(app, 'Deploy "my build"\nnow')

    expect(handedToTheOs()).toEqual([opened])
  })

  it('hands the OS a link a ComfyUI page would also be allowed to open', async () => {
    await openAgentApp('claude', 'Folder: /Users/me/ComfyUI & co?#1')

    const [opened] = handedToTheOs()
    electron.shell.openExternal.mockClear()
    expect(await tryOpenExternalUrlOrAgentApp(opened)).toBe(true)
    expect(handedToTheOs()).toEqual([opened])
  })

  it('replaces a broken character instead of failing to build the link', async () => {
    await openAgentApp('codex', 'name \uD800 end')

    expect(handedToTheOs()).toEqual(['codex://new?prompt=name%20%EF%BF%BD%20end'])
  })

  it.each([
    ['claude', true],
    ['codex', true],
    ['cursor', false],
    ['toString', false],
    [undefined, false]
  ])('knows whether %j is an agent app', (candidate, known) => {
    expect(isAgentApp(candidate)).toBe(known)
  })
})
