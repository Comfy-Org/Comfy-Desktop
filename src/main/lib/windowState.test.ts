import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BrowserWindow } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

let testConfigDir = ''

vi.mock('./paths', () => ({
  configDir: () => testConfigDir
}))

const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
vi.mock('electron', () => ({
  screen: { getDisplayMatching: () => ({ workArea }) }
}))

import {
  _resetWindowStateCacheForTest,
  flushWindowStateSync,
  getSavedBounds,
  getWindowOptions,
  saveWindowBounds
} from './windowState'

const statePath = (): string => path.join(testConfigDir, 'window-state.json')

type Rect = { x: number; y: number; width: number; height: number }

function fakeWindow(
  bounds: Rect,
  {
    maximized = false,
    fullScreen = false,
    normalBounds = bounds
  }: { maximized?: boolean; fullScreen?: boolean; normalBounds?: Rect } = {}
): BrowserWindow {
  return {
    getBounds: () => bounds,
    getNormalBounds: () => normalBounds,
    isMaximized: () => maximized,
    isFullScreen: () => fullScreen
  } as unknown as BrowserWindow
}

beforeEach(() => {
  testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'window-state-'))
  _resetWindowStateCacheForTest()
})

afterEach(() => {
  _resetWindowStateCacheForTest()
  fs.rmSync(testConfigDir, { recursive: true, force: true })
})

describe('windowState', () => {
  it('restores the last saved size after a restart', () => {
    saveWindowBounds('chooser', fakeWindow({ x: 100, y: 50, width: 1500, height: 1000 }))
    flushWindowStateSync()

    _resetWindowStateCacheForTest()
    expect(getWindowOptions('chooser')).toEqual({ x: 100, y: 50, width: 1500, height: 1000 })
  })

  it('writes pending bounds synchronously on flush, before the debounce fires', () => {
    saveWindowBounds('install-1', fakeWindow({ x: 10, y: 20, width: 900, height: 700 }))
    flushWindowStateSync()

    const onDisk = JSON.parse(fs.readFileSync(statePath(), 'utf-8'))
    expect(onDisk['install-1']).toEqual({ x: 10, y: 20, width: 900, height: 700, maximized: false })
  })

  it('keeps the last windowed size while fullscreen', () => {
    saveWindowBounds('install-1', fakeWindow({ x: 10, y: 20, width: 900, height: 700 }))
    saveWindowBounds(
      'install-1',
      fakeWindow({ x: 0, y: 0, width: 1920, height: 1080 }, { fullScreen: true })
    )

    expect(getSavedBounds('install-1')).toEqual({
      x: 10,
      y: 20,
      width: 900,
      height: 700,
      maximized: false
    })
  })

  it('saves the restore size, not a mid-animation frame, while maximized', () => {
    saveWindowBounds('install-1', fakeWindow({ x: 33, y: 53, width: 1607, height: 1028 }))
    saveWindowBounds(
      'install-1',
      fakeWindow(
        { x: 0, y: 0, width: 1920, height: 1080 },
        { maximized: true, normalBounds: { x: 10, y: 20, width: 900, height: 700 } }
      )
    )

    expect(getSavedBounds('install-1')).toEqual({
      x: 10,
      y: 20,
      width: 900,
      height: 700,
      maximized: true
    })
  })

  it('clamps saved bounds to the current display', () => {
    saveWindowBounds('install-1', fakeWindow({ x: 3000, y: 2000, width: 2500, height: 1200 }))

    expect(getWindowOptions('install-1')).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  it('falls back to the default size when nothing is saved', () => {
    expect(getWindowOptions('chooser')).toEqual({ width: 1280, height: 900 })
  })
})
