// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  appsOrigin,
  appsUrl,
  DEFAULT_APPS_URL,
  isAppsFrameUrl,
  isRunId,
  isWorkflow,
  safeUploadName,
  toOutputFile
} from './guards'

describe('appsUrl', () => {
  it('defaults to the hosted site and takes an override', () => {
    expect(appsUrl({})).toBe(DEFAULT_APPS_URL)
    expect(appsUrl({ COMFY_APPS_URL: 'http://127.0.0.1:5310/' })).toBe('http://127.0.0.1:5310/')
  })
})

describe('appsOrigin', () => {
  it('accepts https and loopback http only', () => {
    expect(appsOrigin('https://apps.comfy.org/x')).toBe('https://apps.comfy.org')
    expect(appsOrigin('http://127.0.0.1:5310/')).toBe('http://127.0.0.1:5310')
    expect(appsOrigin('http://apps.comfy.org/')).toBeNull()
    expect(appsOrigin('file:///tmp/a.html')).toBeNull()
    expect(appsOrigin('not a url')).toBeNull()
  })
})

describe('isAppsFrameUrl', () => {
  it('matches the exact origin', () => {
    const origin = 'https://apps.comfy.org'
    expect(isAppsFrameUrl('https://apps.comfy.org/upscale', origin)).toBe(true)
    expect(isAppsFrameUrl('https://apps.comfy.org.evil.com/', origin)).toBe(false)
    expect(isAppsFrameUrl('https://evil.com/?https://apps.comfy.org', origin)).toBe(false)
    expect(isAppsFrameUrl('https://apps.comfy.org/', null)).toBe(false)
  })
})

describe('isWorkflow', () => {
  it('takes an API-format graph and nothing else', () => {
    expect(isWorkflow({ '1': { class_type: 'SaveImage', inputs: {} } })).toBe(true)
    expect(isWorkflow({ '1': { inputs: {} } })).toBe(false)
    expect(isWorkflow([])).toBe(false)
    expect(isWorkflow(null)).toBe(false)
    expect(isWorkflow({ '1': { class_type: 'X', inputs: { t: 'a'.repeat(1_100_000) } } })).toBe(
      false
    )
  })
})

describe('isRunId', () => {
  it('takes a uuid and rejects path tricks', () => {
    expect(isRunId('3f2a7c4e-1b2d-4e5f-9a8b-7c6d5e4f3a2b')).toBe(true)
    expect(isRunId('../billing')).toBe(false)
    expect(isRunId('')).toBe(false)
  })
})

describe('toOutputFile', () => {
  it('keeps output and temp files, refuses climbing out', () => {
    expect(toOutputFile({ filename: 'a.png', subfolder: '', type: 'output' })).toEqual({
      filename: 'a.png',
      subfolder: '',
      type: 'output'
    })
    expect(toOutputFile({ filename: 'a.png', subfolder: '../x', type: 'output' })).toBeNull()
    expect(toOutputFile({ filename: 'a.png', type: 'input' })).toBeNull()
  })
})

describe('safeUploadName', () => {
  it('keeps a plain image name', () => {
    expect(safeUploadName('/Users/me/cat photo.jpg')).toBe('cat_photo.jpg')
    expect(safeUploadName('script.sh')).toBe('upload.png')
    expect(safeUploadName(undefined)).toBe('upload.png')
  })
})
