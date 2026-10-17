import { describe, expect, it } from 'vitest'
import { buildInfoLines, dotStatusOf } from './installStatus'
import type { BuildState } from './installStatus'
import type { Installation } from '../../types/ipc'

const local = { id: 'a', sourceCategory: 'local' } as Installation
const cloud = { id: 'b', sourceCategory: 'cloud' } as Installation
const idle: BuildState = {
  isRunning: false,
  isLaunching: false,
  isStopping: false,
  isUpdating: false,
  hasError: false,
  hasDanger: false
}

describe('dotStatusOf', () => {
  it('is idle for a stopped local build and ready for Comfy Cloud', () => {
    expect(dotStatusOf(local, idle)).toBe('idle')
    expect(dotStatusOf(cloud, idle)).toBe('ready')
  })

  it('is running, or busy while starting, stopping or updating', () => {
    expect(dotStatusOf(local, { ...idle, isRunning: true })).toBe('running')
    expect(dotStatusOf(local, { ...idle, isLaunching: true })).toBe('busy')
    expect(dotStatusOf(local, { ...idle, isRunning: true, isStopping: true })).toBe('busy')
    expect(dotStatusOf(local, { ...idle, isUpdating: true })).toBe('busy')
  })

  it('shows a problem over everything else', () => {
    expect(dotStatusOf(local, { ...idle, isRunning: true, hasError: true })).toBe('error')
    expect(dotStatusOf(cloud, { ...idle, hasDanger: true })).toBe('error')
  })
})

describe('buildInfoLines', () => {
  const t = (key: string, params?: Record<string, unknown>) =>
    params ? `${key}(${Object.values(params).join(',')})` : key

  it('says where a local build runs and lives, its version and last use', () => {
    const inst = { ...local, installPath: '/Users/me/ComfyUI-Installs/Studio' } as Installation
    expect(buildInfoLines(inst, { metaLine: 'Stable · v0.20.1', lastUsed: '5m ago' }, t)).toEqual([
      'buildsDashboard.buildInfo.runsOn(buildsDashboard.runsOn.thisComputer)',
      'Stable · v0.20.1',
      '/Users/me/ComfyUI-Installs/Studio',
      'buildsDashboard.buildInfo.lastUsed(5m ago)'
    ])
  })

  it('says an address once, however it is written', () => {
    const cloud = {
      id: 'c',
      sourceCategory: 'cloud',
      listPreview: 'https://cloud.comfy.org'
    } as Installation
    expect(buildInfoLines(cloud, { metaLine: 'cloud.comfy.org/', lastUsed: '' }, t)).toEqual([
      'buildsDashboard.buildInfo.runsOn(buildsDashboard.runsOn.cloud)',
      'cloud.comfy.org/'
    ])
  })

  it("names a remote build's server, and leaves out what is unknown", () => {
    const remote = {
      id: 'r',
      sourceCategory: 'remote',
      listPreview: 'https://gpu.example.com/'
    } as Installation
    expect(buildInfoLines(remote, { metaLine: '', lastUsed: '' }, t)).toEqual([
      'buildsDashboard.buildInfo.runsOn(gpu.example.com)',
      'gpu.example.com'
    ])
  })
})
