import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportTemplateSent } from './searchTelemetry'
import {
  buildTemplateDeeplink,
  claimTemplateOpen,
  CLAIM_WINDOW_MS,
  dropTemplateOpen,
  queueTemplateOpen,
  takeLaunchUrl
} from './openTemplate'

vi.mock('./searchTelemetry', () => ({ reportTemplateSent: vi.fn() }))

const COMFY_URL = 'http://127.0.0.1:8390/'

afterEach(() => {
  dropTemplateOpen('build-1')
  dropTemplateOpen('build-2')
  vi.clearAllMocks()
})

describe('buildTemplateDeeplink', () => {
  it('adds the template and its source to the ComfyUI address', () => {
    expect(buildTemplateDeeplink('http://127.0.0.1:8390/?lang=en', 'poster_template')).toBe(
      'http://127.0.0.1:8390/?lang=en&template=poster_template&source=default'
    )
  })

  it('leaves an address it cannot read unchanged', () => {
    expect(buildTemplateDeeplink('not a url', 'poster_template')).toBe('not a url')
  })
})

describe('the queued template', () => {
  it('opens once, for a launch that claimed it, then ComfyUI itself', () => {
    queueTemplateOpen('build-1', 'poster_template', 1000)
    expect(takeLaunchUrl('build-1', COMFY_URL)).toBe(COMFY_URL)

    claimTemplateOpen('build-1', 2000)
    expect(takeLaunchUrl('build-1', COMFY_URL)).toBe(
      'http://127.0.0.1:8390/?template=poster_template&source=default'
    )
    expect(takeLaunchUrl('build-1', COMFY_URL)).toBe(COMFY_URL)
  })

  it('is forgotten when no launch claims it within the window', () => {
    queueTemplateOpen('build-1', 'poster_template', 1000)
    claimTemplateOpen('build-1', 1000 + CLAIM_WINDOW_MS + 1)
    claimTemplateOpen('build-1', 1000)
    expect(takeLaunchUrl('build-1', COMFY_URL)).toBe(COMFY_URL)
  })

  it('keeps each build to its own template, and the latest pick wins', () => {
    queueTemplateOpen('build-1', 'poster_template')
    queueTemplateOpen('build-1', 'video_template')
    queueTemplateOpen('build-2', 'poster_template')
    claimTemplateOpen('build-1')
    claimTemplateOpen('build-2')

    expect(takeLaunchUrl('build-1', COMFY_URL)).toContain('template=video_template')
    expect(takeLaunchUrl('build-2', COMFY_URL)).toContain('template=poster_template')
  })

  it('opens nothing once dropped', () => {
    queueTemplateOpen('build-1', 'poster_template')
    claimTemplateOpen('build-1')
    dropTemplateOpen('build-1')
    expect(takeLaunchUrl('build-1', COMFY_URL)).toBe(COMFY_URL)
  })
})

describe('reporting the queued template', () => {
  it('reports the template handed to the starting build, the search it came from and the wait', () => {
    queueTemplateOpen('build-1', 'poster_template', 1000, '2b1c7a3e-9f4d-4c8a-8e1b-5d6f7a8b9c0d')
    claimTemplateOpen('build-1', 1500)
    takeLaunchUrl('build-1', COMFY_URL, 4000)
    expect(reportTemplateSent).toHaveBeenCalledExactlyOnceWith({
      searchId: '2b1c7a3e-9f4d-4c8a-8e1b-5d6f7a8b9c0d',
      templateId: 'poster_template',
      pickToSendMs: 3000
    })
  })

  it('reports nothing when the build starts without a claimed template', () => {
    queueTemplateOpen('build-1', 'poster_template', 1000)
    takeLaunchUrl('build-1', COMFY_URL, 4000)
    takeLaunchUrl('build-2', COMFY_URL, 4000)
    expect(reportTemplateSent).not.toHaveBeenCalled()
  })
})
