import { describe, expect, it } from 'vitest'

import {
  MAX_OUTPUTS,
  MAX_OUTPUTS_BYTES,
  readOutputAction,
  readOutputRequest
} from './outputRequest'

const picture = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'picture-1.png',
  mimeType: 'image/png',
  bytes: new Uint8Array([1, 2, 3]),
  ...extra
})

describe('readOutputRequest', () => {
  it('keeps the outputs and the one to show first', () => {
    const request = readOutputRequest({
      items: [
        picture({ tags: ['Upscaled', 7, ' '], workflow: true }),
        picture({ name: ' clip.mp4 ', mimeType: 'video/mp4' })
      ],
      index: 1
    })

    expect(request?.index).toBe(1)
    expect(request?.items[0]).toMatchObject({
      name: 'picture-1.png',
      tags: ['Upscaled'],
      workflow: true
    })
    expect(request?.items[1]).toMatchObject({ name: 'clip.mp4', tags: [], workflow: false })
  })

  it('keeps what the Apps pages send today and drops the fields Desktop does not show', () => {
    const request = readOutputRequest({
      items: [picture({ tags: [], workflow: false, savedOn: 'computer', folder: '/tmp', size: 3 })],
      index: 0
    })

    expect(request?.items[0]).toEqual({
      name: 'picture-1.png',
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
      tags: [],
      workflow: false,
      savedOn: 'computer',
      folder: '/tmp'
    })
  })

  it('keeps where each output is saved, with a folder and a ComfyUI file only for this computer', () => {
    const comfyFile = { filename: 'cutout_00001_.png', subfolder: 'apps/cutout', type: 'output' }
    const request = readOutputRequest({
      items: [
        picture({ savedOn: 'cloud', folder: '/Users/me/out', comfyFile }),
        picture({ savedOn: 'computer', folder: 'C:\\Users\\me\\out' }),
        picture({ savedOn: 'computer', comfyFile }),
        picture({ savedOn: 'computer' }),
        picture({ savedOn: 'phone', folder: '/Users/me/out' })
      ],
      index: 0
    })

    expect(
      request?.items.map(({ savedOn, folder, comfyFile }) => ({ savedOn, folder, comfyFile }))
    ).toEqual([
      { savedOn: 'cloud', folder: undefined, comfyFile: undefined },
      { savedOn: 'computer', folder: 'C:\\Users\\me\\out', comfyFile: undefined },
      {
        savedOn: 'computer',
        folder: undefined,
        comfyFile: { filename: 'cutout_00001_.png', subfolder: 'apps/cutout' }
      },
      { savedOn: 'computer', folder: undefined, comfyFile: undefined },
      { savedOn: undefined, folder: undefined, comfyFile: undefined }
    ])
  })

  it('drops a folder that is not an absolute path or has hidden characters', () => {
    const folders = ['out', './out', '~/out', '/Users/me/\u202eout', '/Users/me/\nout', 7]
    const request = readOutputRequest({
      items: folders.map((folder) => picture({ savedOn: 'computer', folder })),
      index: 0
    })

    expect(request?.items.map((item) => item.folder)).toEqual(folders.map(() => undefined))
  })

  it('drops a ComfyUI file that is not a ComfyUI output', () => {
    const file = (extra: Record<string, unknown>) => ({
      filename: 'cutout.png',
      subfolder: '',
      type: 'output',
      ...extra
    })
    const refused = [
      file({ type: 'temp' }),
      file({ type: undefined }),
      file({ filename: 7 }),
      file({ subfolder: 7 }),
      'cutout.png'
    ]
    const request = readOutputRequest({
      items: refused.map((comfyFile) => picture({ savedOn: 'computer', comfyFile })),
      index: 0
    })

    expect(request?.items.map((item) => item.comfyFile)).toEqual(refused.map(() => undefined))
  })

  it('cuts long names and tags, and keeps at most eight tags', () => {
    const request = readOutputRequest({
      items: [
        picture({ name: 'n'.repeat(300), tags: Array.from({ length: 12 }, () => 't'.repeat(60)) })
      ],
      index: 0
    })

    expect(request?.items[0]?.name).toHaveLength(200)
    expect(request?.items[0]?.tags).toHaveLength(8)
    expect(request?.items[0]?.tags[0]).toHaveLength(40)
  })

  it('refuses a name with hidden characters, and drops such tags', () => {
    for (const name of ['cut\u202eout.png', 'cut\nout.png', 'cut\u0000out.png']) {
      expect(readOutputRequest({ items: [picture({ name })], index: 0 }), name).toBeNull()
    }
    const request = readOutputRequest({
      items: [picture({ tags: ['portrait', 'sea\u2066side', 'night\u007f'] })],
      index: 0
    })
    expect(request?.items[0]?.tags).toEqual(['portrait'])
  })

  it('refuses outputs it cannot show', () => {
    expect(readOutputRequest(null)).toBeNull()
    expect(readOutputRequest({ items: [], index: 0 })).toBeNull()
    expect(readOutputRequest({ items: [picture()], index: 1 })).toBeNull()
    expect(readOutputRequest({ items: [picture()], index: -1 })).toBeNull()
    expect(readOutputRequest({ items: [picture()], index: 0.5 })).toBeNull()
    expect(readOutputRequest({ items: [picture({ mimeType: 'text/html' })], index: 0 })).toBeNull()
    expect(
      readOutputRequest({ items: [picture({ mimeType: 'image/svg+xml' })], index: 0 })
    ).toBeNull()
    expect(readOutputRequest({ items: [picture({ bytes: 'abc' })], index: 0 })).toBeNull()
    expect(readOutputRequest({ items: [picture({ name: ' ' })], index: 0 })).toBeNull()
  })

  it(`refuses more than ${MAX_OUTPUTS} outputs`, () => {
    const items = Array.from({ length: MAX_OUTPUTS + 1 }, () => picture())

    expect(readOutputRequest({ items, index: 0 })).toBeNull()
    expect(readOutputRequest({ items: items.slice(1), index: 0 })).not.toBeNull()
  })

  it('refuses more bytes in all than Desktop takes', () => {
    const half = new Uint8Array(MAX_OUTPUTS_BYTES / 2 + 1)

    expect(
      readOutputRequest({ items: [picture({ bytes: half }), picture({ bytes: half })], index: 0 })
    ).toBeNull()
  })

  it('counts the whole buffer behind each output', () => {
    const view = new Uint8Array(new ArrayBuffer(MAX_OUTPUTS_BYTES + 1), 0, 1)

    expect(readOutputRequest({ items: [picture({ bytes: view })], index: 0 })).toBeNull()
  })

  it('refuses an items list with holes', () => {
    const items = [picture(), picture()]
    delete items[0]

    expect(readOutputRequest({ items, index: 1 })).toBeNull()
  })
})

describe('readOutputAction', () => {
  it('passes on a download, an open-workflow or a show-in-folder for one output', () => {
    expect(readOutputAction({ action: 'show-in-folder', index: 1 })).toEqual({
      action: 'show-in-folder',
      index: 1
    })
    expect(readOutputAction({ action: 'download', index: 2 })).toEqual({
      action: 'download',
      index: 2
    })
    expect(readOutputAction({ action: 'open-workflow', index: 0 })).toEqual({
      action: 'open-workflow',
      index: 0
    })
  })

  it('drops anything else', () => {
    expect(readOutputAction({ action: 'delete', index: 0 })).toBeNull()
    expect(readOutputAction({ action: 'download', index: 1.5 })).toBeNull()
    expect(readOutputAction({ action: 'download', index: -1 })).toBeNull()
    expect(readOutputAction('download')).toBeNull()
  })
})
