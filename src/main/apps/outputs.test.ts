// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  MAX_OUTPUTS,
  MAX_OUTPUTS_BYTES,
  outputAction,
  outputRequest,
  resolveOutputFiles
} from './outputs'

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

  it('keeps where an output is saved, and a folder only for this computer', () => {
    const request = outputRequest({
      items: [
        picture({ savedOn: 'computer', folder: '/Users/me/ComfyUI-Shared/output/apps' }),
        picture({ savedOn: 'cloud', folder: '/ignored' }),
        picture({ savedOn: 'mars', folder: '/ignored' })
      ],
      index: 0
    })
    expect(request?.items[0]).toMatchObject({
      savedOn: 'computer',
      folder: '/Users/me/ComfyUI-Shared/output/apps'
    })
    expect(request?.items[1]?.savedOn).toBe('cloud')
    expect(request?.items[1]).not.toHaveProperty('folder')
    expect(request?.items[2]).not.toHaveProperty('savedOn')
    expect(request?.items[2]).not.toHaveProperty('folder')
  })

  it('keeps only an absolute folder with no hidden characters', () => {
    const folderOf = (folder: string) =>
      outputRequest({ items: [picture({ savedOn: 'computer', folder })], index: 0 })?.items[0]
        ?.folder
    expect(folderOf('C:\\Users\\me\\output')).toBe('C:\\Users\\me\\output')
    expect(folderOf('relative/output')).toBeUndefined()
    expect(folderOf('\\\\server\\share')).toBeUndefined()
    expect(folderOf('/Users/me/\u202eoutput')).toBeUndefined()
    expect(folderOf('/Users/me/out\nput')).toBeUndefined()
  })

  it('keeps the ComfyUI output reference of an output made on this computer', () => {
    const request = outputRequest({
      items: [
        picture({
          savedOn: 'computer',
          comfyFile: { filename: 'ComfyUI_00001_.png', subfolder: 'apps\\text', type: 'output' }
        }),
        picture({ savedOn: 'cloud', comfyFile: { filename: 'a.png', type: 'output' } })
      ],
      index: 0
    })
    expect(request?.items[0]?.comfyFile).toEqual({
      filename: 'ComfyUI_00001_.png',
      subfolder: 'apps/text'
    })
    expect(request?.items[1]).not.toHaveProperty('comfyFile')
  })

  it('drops a ComfyUI output reference that could climb out of the output folder', () => {
    const fileOf = (comfyFile: unknown) =>
      outputRequest({ items: [picture({ savedOn: 'computer', comfyFile })], index: 0 })?.items[0]
        ?.comfyFile
    expect(fileOf({ filename: 'a.png', type: 'output' })).toEqual({
      filename: 'a.png',
      subfolder: ''
    })
    expect(fileOf({ filename: 'a.png', subfolder: '', type: 'temp' })).toBeUndefined()
    expect(fileOf({ filename: '../a.png', subfolder: '', type: 'output' })).toBeUndefined()
    expect(fileOf({ filename: '..', subfolder: '', type: 'output' })).toBeUndefined()
    expect(fileOf({ filename: 'a.png', subfolder: '../other', type: 'output' })).toBeUndefined()
    expect(fileOf({ filename: 'a.png', subfolder: 'apps/../..', type: 'output' })).toBeUndefined()
    expect(fileOf({ filename: 'a.png', subfolder: '/etc', type: 'output' })).toBeUndefined()
    expect(fileOf({ filename: 'a.png', subfolder: 'C:\\out', type: 'output' })).toBeUndefined()
    expect(fileOf({ filename: 'a.png', subfolder: 'apps//x', type: 'output' })).toBeUndefined()
    expect(fileOf({ filename: 'a\u202e.png', subfolder: '', type: 'output' })).toBeUndefined()
    expect(fileOf({ filename: 7, subfolder: '', type: 'output' })).toBeUndefined()
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

describe('resolveOutputFiles', () => {
  it('shows the folder Desktop found and never one the page sent with the reference', async () => {
    const request = outputRequest({
      items: [
        picture({
          savedOn: 'computer',
          comfyFile: { filename: 'found.png', subfolder: '', type: 'output' }
        }),
        picture({
          savedOn: 'computer',
          folder: '/Users/me/elsewhere',
          comfyFile: { filename: 'gone.png', subfolder: '', type: 'output' }
        }),
        picture({ savedOn: 'computer', folder: '/Users/me/output/apps' }),
        picture({ savedOn: 'cloud' })
      ],
      index: 0
    })
    const resolve = async (file: { filename: string }) =>
      file.filename === 'found.png' ? '/Users/me/output/found.png' : null

    const { items, files } = await resolveOutputFiles(request!.items, resolve)

    expect(files).toEqual(['/Users/me/output/found.png', null, null, null])
    expect(items[0]).toMatchObject({ savedOn: 'computer', folder: '/Users/me/output' })
    expect(items[1]).not.toHaveProperty('folder')
    expect(items[2]).toMatchObject({ folder: '/Users/me/output/apps' })
    expect(items[3]).toMatchObject({ savedOn: 'cloud' })
    for (const item of items) expect(item).not.toHaveProperty('comfyFile')
  })

  it('treats a lookup that fails as not found', async () => {
    const request = outputRequest({
      items: [picture({ savedOn: 'computer', comfyFile: { filename: 'a.png', type: 'output' } })],
      index: 0
    })
    const { files } = await resolveOutputFiles(request!.items, () =>
      Promise.reject(new Error('disk gone'))
    )
    expect(files).toEqual([null])
  })
})

describe('outputAction', () => {
  it('passes on a download, an open-workflow or a show-in-folder for one output', () => {
    expect(outputAction({ action: 'show-in-folder', index: 1 })).toEqual({
      action: 'show-in-folder',
      index: 1
    })
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
