import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  appBundlePath,
  classifyMacAppLocation,
  clearInstallAttempt,
  describeAppLocation,
  markInstallAttemptExit,
  readInstallAttempt,
  readMacBundleId,
  readShipItReport,
  shipItErrorTail,
  shipItLogPath,
  writeInstallAttempt,
  type InstallAttemptRecord
} from './update-install-attempt'

let mockConfigDir: string

vi.mock('./paths', () => ({
  configDir: () => mockConfigDir
}))

let dir: string

const record: InstallAttemptRecord = {
  attemptId: 'attempt-1',
  targetVersion: '1.2.1',
  fromVersion: '1.2.0',
  source: 'install_call',
  triggeredAt: '2026-11-22T10:00:00.000Z'
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-install-attempt-test-'))
  mockConfigDir = dir
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('install attempt record', () => {
  it('reads nothing when no install was requested', () => {
    expect(readInstallAttempt()).toBeNull()
  })

  it('writes, reads back and clears a record', () => {
    expect(writeInstallAttempt(record)).toBe(true)
    expect(readInstallAttempt()).toEqual(record)
    clearInstallAttempt()
    expect(readInstallAttempt()).toBeNull()
  })

  it('ignores a record with missing fields', () => {
    fs.writeFileSync(
      path.join(dir, 'update-install-attempt.json'),
      JSON.stringify({ targetVersion: '1.2.1' })
    )
    expect(readInstallAttempt()).toBeNull()
  })

  it('ignores a record that is not JSON', () => {
    fs.writeFileSync(path.join(dir, 'update-install-attempt.json'), 'not json')
    expect(readInstallAttempt()).toBeNull()
  })

  it('stamps the first exit after the install request and keeps it', () => {
    writeInstallAttempt(record)
    markInstallAttemptExit('update-install', new Date('2026-11-22T10:00:05.000Z'))
    markInstallAttemptExit('user-quit', new Date('2026-11-22T11:00:00.000Z'))
    expect(readInstallAttempt()).toEqual({
      ...record,
      exitedAt: '2026-11-22T10:00:05.000Z',
      exitQuitReason: 'update-install'
    })
  })

  it('does nothing on exit when no install was requested', () => {
    markInstallAttemptExit('user-quit')
    expect(readInstallAttempt()).toBeNull()
  })
})

describe('app location', () => {
  it('finds the .app bundle from the Mac executable', () => {
    expect(
      appBundlePath('/Applications/Comfy Desktop.app/Contents/MacOS/Comfy Desktop', 'darwin')
    ).toBe('/Applications/Comfy Desktop.app')
  })

  it('uses the executable folder on other platforms', () => {
    expect(appBundlePath('/opt/Comfy Desktop/comfyui-desktop-2', 'linux')).toBe(
      '/opt/Comfy Desktop'
    )
  })

  it.each([
    ['/Applications/Comfy Desktop.app', 'applications'],
    ['/Users/me/Applications/Comfy Desktop.app', 'user_applications'],
    ['/private/var/folders/xy/T/AppTranslocation/1234/d/Comfy Desktop.app', 'translocated'],
    ['/Volumes/Comfy Desktop/Comfy Desktop.app', 'mounted_volume'],
    ['/Users/me/Downloads/Comfy Desktop.app', 'other']
  ])('classifies %s as %s', (bundlePath, kind) => {
    expect(classifyMacAppLocation(bundlePath, '/Users/me')).toBe(kind)
  })

  it('reports a writable bundle and parent folder', () => {
    const bundle = path.join(dir, 'Comfy Desktop.app')
    const exe = path.join(bundle, 'Contents', 'MacOS', 'Comfy Desktop')
    fs.mkdirSync(path.dirname(exe), { recursive: true })
    expect(describeAppLocation(exe, 'darwin', '/Users/me')).toEqual({
      bundlePath: bundle,
      kind: 'other',
      writable: true
    })
  })

  it('reports a missing bundle as not writable, with no kind off Mac', () => {
    expect(describeAppLocation(path.join(dir, 'gone', 'app.exe'), 'win32', dir)).toEqual({
      bundlePath: path.join(dir, 'gone'),
      kind: null,
      writable: false
    })
  })
})

describe('ShipIt report', () => {
  it('reads the bundle id from Info.plist', () => {
    const bundle = path.join(dir, 'Comfy Desktop.app')
    fs.mkdirSync(path.join(bundle, 'Contents'), { recursive: true })
    fs.writeFileSync(
      path.join(bundle, 'Contents', 'Info.plist'),
      '<dict>\n<key>CFBundleIdentifier</key>\n  <string>com.example.desktop</string>\n</dict>'
    )
    expect(readMacBundleId(bundle)).toBe('com.example.desktop')
  })

  it('has no bundle id without an Info.plist', () => {
    expect(readMacBundleId(path.join(dir, 'missing.app'))).toBeNull()
  })

  it('builds the ShipIt log path in the user cache folder', () => {
    expect(shipItLogPath('/Users/me', 'com.example.desktop')).toBe(
      '/Users/me/Library/Caches/com.example.desktop.ShipIt/ShipIt_stderr.log'
    )
  })

  it('keeps only the last error lines', () => {
    const lines = [
      'Beginning installation',
      ...Array.from({ length: 7 }, (_, i) => `error ${i}: could not move bundle`),
      'Installation finished'
    ]
    const tail = shipItErrorTail(lines.join('\n'))
    expect(tail).not.toContain('error 1:')
    expect(tail).toContain('error 2:')
    expect(tail).toContain('error 6:')
    expect(tail).not.toContain('Installation finished')
  })

  it('has no error tail when no line reports an error', () => {
    expect(shipItErrorTail('Beginning installation\nInstallation finished')).toBeNull()
  })

  it('reports no log when there is no log path', () => {
    expect(readShipItReport(null, new Date())).toEqual({
      logFound: false,
      ranAfterTrigger: null,
      errorTail: null
    })
  })

  it('reports no log when the log file is missing', () => {
    expect(readShipItReport(path.join(dir, 'ShipIt_stderr.log'), new Date())).toEqual({
      logFound: false,
      ranAfterTrigger: null,
      errorTail: null
    })
  })

  it('reads the error tail when ShipIt wrote after the install request', () => {
    const logPath = path.join(dir, 'ShipIt_stderr.log')
    fs.writeFileSync(logPath, 'Installation error: Operation not permitted\n')
    const report = readShipItReport(logPath, new Date(Date.now() - 60_000))
    expect(report.logFound).toBe(true)
    expect(report.ranAfterTrigger).toBe(true)
    expect(report.errorTail).toContain('Operation not permitted')
  })

  it('skips the error tail when ShipIt last wrote before the install request', () => {
    const logPath = path.join(dir, 'ShipIt_stderr.log')
    fs.writeFileSync(logPath, 'Installation error: old failure\n')
    const past = new Date(Date.now() - 3_600_000)
    fs.utimesSync(logPath, past, past)
    expect(readShipItReport(logPath, new Date())).toEqual({
      logFound: true,
      ranAfterTrigger: false,
      errorTail: null
    })
  })
})
