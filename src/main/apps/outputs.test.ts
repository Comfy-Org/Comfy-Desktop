// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { MAX_OUTPUTS, MAX_OUTPUTS_BYTES, outputAction, outputRequest } from './outputs'

const picture = (extra: Record<string, unknown> = {}) => ({
  name: 'picture-1.png',
  mimeType: 'image/png',
  bytes: new Uint8Array([1, 2, 3]),
  ...extra
})

describe('outputRequest', () => {
  it('keeps the outputs and the one to show first', () => {
    const request = outputRequest({
      items: [
        picture({ tags: ['This computer', 7, ' '], workflow: true }),
        picture({ name: 'clip.mp4', mimeType: 'video/mp4' })
      ],
      index: 1
    })
    expect(request?.index).toBe(1)
    expect(request?.items[0]).toMatchObject({
      name: 'picture-1.png',
      tags: ['This computer'],
      workflow: true
    })
    expect(request?.items[1]).toMatchObject({ workflow: false, tags: [] })
  })

  it('refuses outputs it cannot show', () => {
    expect(outputRequest(null)).toBeNull()
    expect(outputRequest({ items: [], index: 0 })).toBeNull()
    expect(outputRequest({ items: [picture()], index: 1 })).toBeNull()
    expect(outputRequest({ items: [picture()], index: -1 })).toBeNull()
    expect(outputRequest({ items: [picture({ mimeType: 'text/html' })], index: 0 })).toBeNull()
    expect(outputRequest({ items: [picture({ mimeType: 'image/svg+xml' })], index: 0 })).toBeNull()
    expect(outputRequest({ items: [picture({ bytes: 'abc' })], index: 0 })).toBeNull()
    expect(outputRequest({ items: [picture({ name: ' ' })], index: 0 })).toBeNull()
    expect(
      outputRequest({ items: Array.from({ length: MAX_OUTPUTS + 1 }, () => picture()), index: 0 })
    ).toBeNull()
    const half = new Uint8Array(MAX_OUTPUTS_BYTES / 2 + 1)
    expect(
      outputRequest({ items: [picture({ bytes: half }), picture({ bytes: half })], index: 0 })
    ).toBeNull()
  })
})

describe('outputAction', () => {
  it('passes on a download or an open-workflow for one output', () => {
    expect(outputAction({ action: 'download', index: 2 })).toEqual({ action: 'download', index: 2 })
    expect(outputAction({ action: 'open-workflow', index: 0 })).toEqual({
      action: 'open-workflow',
      index: 0
    })
  })

  it('drops anything else', () => {
    expect(outputAction({ action: 'delete', index: 0 })).toBeNull()
    expect(outputAction({ action: 'download', index: 1.5 })).toBeNull()
    expect(outputAction('download')).toBeNull()
  })
})
