import { describe, expect, it } from 'vitest'
import { progressOpKindForActionId, updatesBuildInPlace } from './progressOpKind'

describe('progressOpKindForActionId', () => {
  it('classifies update actions as update ops', () => {
    expect(progressOpKindForActionId('update-comfyui')).toBe('update')
    expect(progressOpKindForActionId('update')).toBe('update')
    expect(progressOpKindForActionId('release-update')).toBe('update')
    expect(progressOpKindForActionId('copy-update')).toBe('update')
    expect(progressOpKindForActionId('copy-pytorch')).toBe('update')
  })

  it('classifies a version check as generic, not an update op', () => {
    expect(progressOpKindForActionId('check-update')).toBe('generic')
  })

  it('keeps the remaining action families distinct', () => {
    expect(progressOpKindForActionId('launch')).toBe('launch')
    expect(progressOpKindForActionId('restart')).toBe('launch')
    expect(progressOpKindForActionId('delete')).toBe('destructive')
    expect(progressOpKindForActionId('restore-snapshot')).toBe('snapshot')
    expect(progressOpKindForActionId('install-instance')).toBe('install')
    expect(progressOpKindForActionId('rename')).toBe('generic')
  })
})

describe('updatesBuildInPlace', () => {
  it('is true for updates that change the build itself', () => {
    expect(updatesBuildInPlace('update', 'update-comfyui')).toBe(true)
    expect(updatesBuildInPlace('update', 'release-update')).toBe(true)
    expect(updatesBuildInPlace('update', 'update')).toBe(true)
  })

  it('is false for updates that make a copy, and for other op kinds', () => {
    expect(updatesBuildInPlace('update', 'copy-update')).toBe(false)
    expect(updatesBuildInPlace('update', 'copy-pytorch')).toBe(false)
    expect(updatesBuildInPlace('snapshot', 'restore-snapshot')).toBe(false)
    expect(updatesBuildInPlace('install', 'install-instance')).toBe(false)
  })
})
