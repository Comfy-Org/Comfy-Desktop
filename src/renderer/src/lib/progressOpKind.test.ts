import { describe, expect, it } from 'vitest'
import { progressOpKindForActionId } from './progressOpKind'

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
