import { describe, expect, it } from 'vitest'
import { DEV_DESKTOP_ENTRY_ENV as MAIN_DEV_DESKTOP_ENTRY_ENV } from '../../src/main/apps/draftLinkStartup'
import {
  DEV_DESKTOP_ENTRY_ENV,
  LINUX_DEV_ENTRY,
  desktopEntryFileName,
  desktopEntryText,
  devSandboxOff,
  mimeappsWithout
} from './linuxEntry.mjs'

const ELECTRON = '/src/Comfy-Desktop/node_modules/electron/dist/electron'

describe('desktopEntryFileName', () => {
  it('names one entry per clone', () => {
    expect(desktopEntryFileName('/src/a')).toMatch(/^comfy-desktop-dev-[0-9a-f]{12}\.desktop$/)
    expect(desktopEntryFileName('/src/a')).toBe(desktopEntryFileName('/src/a'))
    expect(desktopEntryFileName('/src/a')).not.toBe(desktopEntryFileName('/src/b'))
  })
})

describe('desktopEntryText', () => {
  it('starts node_modules Electron on the clone with the link and claims the scheme', () => {
    expect(
      desktopEntryText({
        ...LINUX_DEV_ENTRY,
        executable: ELECTRON,
        root: '/src/Comfy-Desktop',
        disableSandbox: false
      })
    ).toBe(
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Comfy Desktop Dev',
        `Exec="${ELECTRON}" "/src/Comfy-Desktop" %u`,
        'MimeType=x-scheme-handler/comfy;',
        'NoDisplay=true',
        'Terminal=false',
        ''
      ].join('\n')
    )
  })

  it('keeps the sandbox off for a click when the dev run had it off', () => {
    const text = desktopEntryText({
      ...LINUX_DEV_ENTRY,
      executable: ELECTRON,
      root: '/src/Comfy-Desktop',
      disableSandbox: true
    })
    expect(text).toContain(
      `Exec=env ELECTRON_DISABLE_SANDBOX=1 "${ELECTRON}" "/src/Comfy-Desktop" --no-sandbox %u`
    )
  })

  it('quotes a clone path with spaces, quotes, dollars and percent signs', () => {
    const text = desktopEntryText({
      ...LINUX_DEV_ENTRY,
      executable: ELECTRON,
      root: '/home/me/my "100%" $work',
      disableSandbox: false
    })
    expect(text).toContain(`Exec="${ELECTRON}" "/home/me/my \\\\"100%%\\\\" \\\\$work" %u`)
  })
})

describe('devSandboxOff', () => {
  it('is off when ELECTRON_DISABLE_SANDBOX=1 is set', () => {
    expect(devSandboxOff({ ELECTRON_DISABLE_SANDBOX: '1' }, [])).toBe(true)
  })

  it('is off when NO_SANDBOX=1 is set', () => {
    expect(devSandboxOff({ NO_SANDBOX: '1' }, [])).toBe(true)
  })

  it('is off when electron-vite is given --noSandbox', () => {
    expect(devSandboxOff({}, ['--noSandbox'])).toBe(true)
    expect(devSandboxOff({}, ['--watch', '--noSandbox=true'])).toBe(true)
  })

  it('is on otherwise', () => {
    expect(devSandboxOff({}, [])).toBe(false)
    expect(devSandboxOff({ ELECTRON_DISABLE_SANDBOX: '0', NO_SANDBOX: '0' }, ['--watch'])).toBe(
      false
    )
    expect(devSandboxOff({}, ['--noSandbox=false'])).toBe(false)
  })

  it('ignores --noSandbox passed through to Electron after --', () => {
    expect(devSandboxOff({}, ['--', '--noSandbox'])).toBe(false)
  })
})

describe('mimeappsWithout', () => {
  const entry = desktopEntryFileName('/src/Comfy-Desktop')

  it('drops the default that points at this clone', () => {
    const text = [
      '[Default Applications]',
      `x-scheme-handler/comfy=${entry}`,
      'text/html=firefox.desktop',
      ''
    ].join('\n')
    expect(mimeappsWithout(text, 'x-scheme-handler/comfy', entry)).toBe(
      ['[Default Applications]', 'text/html=firefox.desktop', ''].join('\n')
    )
  })

  it('keeps other handlers listed for the scheme', () => {
    const text = [
      '[Added Associations]',
      `x-scheme-handler/comfy=${entry};comfy-desktop.desktop;`
    ].join('\n')
    expect(mimeappsWithout(text, 'x-scheme-handler/comfy', entry)).toBe(
      ['[Added Associations]', 'x-scheme-handler/comfy=comfy-desktop.desktop;'].join('\n')
    )
  })

  it('leaves a file that does not name this clone unchanged', () => {
    const text = [
      '[Default Applications]',
      'x-scheme-handler/comfy=comfy-desktop.desktop',
      '[Removed Associations]',
      `x-scheme-handler/comfy=${entry}`
    ].join('\n')
    expect(mimeappsWithout(text, 'x-scheme-handler/comfy', entry)).toBe(text)
  })
})

describe('DEV_DESKTOP_ENTRY_ENV', () => {
  it('uses the same env name as the main process', () => {
    expect(DEV_DESKTOP_ENTRY_ENV).toBe(MAIN_DEV_DESKTOP_ENTRY_ENV)
  })
})
