// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  appsOrigin,
  appsUrl,
  cleanSaveName,
  collectOutputs,
  DEFAULT_APPS_URL,
  isAppsFrameUrl,
  isInside,
  isRunId,
  isVersionsIndex,
  isWorkflow,
  outputKind,
  readable,
  safeUploadName,
  saveExt,
  savedFileName,
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
  it('keeps a video name', () => {
    expect(safeUploadName('shot.mp4')).toBe('shot.mp4')
    expect(safeUploadName('shot.webm')).toBe('shot.webm')
  })
})

describe('collectOutputs', () => {
  // The shapes Comfy Cloud's /history_v2 gave on 2026-11-04.
  const outputs = {
    save: {
      animated: [true],
      images: [
        { filename: 'a.mp4', subfolder: 'apps', type: 'output', metadata: { kind: 'video' } }
      ]
    },
    glb: { '3d': [{ filename: 'b.glb', subfolder: 'apps', type: 'output' }], camera_info: [] },
    lens: { files: [{ filename: 'c.txt', subfolder: 'apps', type: 'output' }], text: ['43.6'] },
    show: { text: ['{"keys": []}'] },
    load: { images: [{ filename: 'in.mp4', subfolder: '', type: 'input' }] }
  }
  it('lists every saved file with its node and kind, and the text by node', () => {
    const { files, text } = collectOutputs(outputs)
    expect(files.map((f) => [f.node, f.filename, f.kind])).toEqual([
      ['save', 'a.mp4', 'video'],
      ['glb', 'b.glb', '3d'],
      ['lens', 'c.txt', 'text']
    ])
    expect(text).toEqual({ lens: ['43.6'], show: ['{"keys": []}'] })
  })
  it('takes junk without throwing', () => {
    expect(collectOutputs(null)).toEqual({ files: [], text: {} })
    expect(collectOutputs({ a: 1, b: { images: 'x' } })).toEqual({ files: [], text: {} })
  })
  it('names kinds by extension', () => {
    expect(outputKind('x.PNG')).toBe('image')
    expect(outputKind('x.bin')).toBe('file')
    expect(outputKind('voice.mp3')).toBe('audio')
  })
})

describe('saving results', () => {
  it('takes letters, digits, dashes and spaces only', () => {
    expect(cleanSaveName('motion-to-video')).toBe('motion-to-video')
    expect(cleanSaveName(' camera  v3 ')).toBe('camera v3')
    expect(cleanSaveName('../etc')).toBeNull()
    expect(cleanSaveName('a/b')).toBeNull()
    expect(cleanSaveName('')).toBeNull()
    expect(cleanSaveName(3)).toBeNull()
  })
  it('allows known extensions only', () => {
    expect(saveExt('.MP4')).toBe('mp4')
    expect(saveExt('glb')).toBe('glb')
    expect(saveExt('sh')).toBeNull()
    expect(saveExt('mp3')).toBe('mp3')
  })
  it('names a file by date, time and label', () => {
    expect(savedFileName('film', 'mp4', new Date(2026, 10, 4, 11, 41))).toBe(
      '2026-11-04 11-41 film.mp4'
    )
  })
  it('knows what is inside the apps folder', () => {
    expect(isInside('/o/apps/m/a.mp4', '/o/apps')).toBe(true)
    expect(isInside('/o/apps-evil/a.mp4', '/o/apps')).toBe(false)
    expect(isInside('/o/apps', '/o/apps')).toBe(false)
  })
})

describe('readable', () => {
  it("keeps the provider's message out of a partner node's JSON", () => {
    const raw =
      'Polling aborted due to error: Task failed: {"id": "cgt-1", "status": "failed", "error": {"code": "OutputVideoSensitiveContentDetected.PolicyViolation", "message": "The request failed because the output video may be related to copyright restrictions."}}\n'
    expect(readable(raw)).toBe(
      'The request failed because the output video may be related to copyright restrictions.'
    )
  })
  it('keeps a plain message as it is', () => {
    expect(readable(' Out of memory. ')).toBe('Out of memory.')
    expect(readable(undefined)).toBeUndefined()
  })
})

describe('isVersionsIndex', () => {
  const bytes = (s: string) => new TextEncoder().encode(s)
  it('takes a JSON object', () => {
    expect(isVersionsIndex(bytes('{"steps":{}}'))).toBe(true)
  })
  it('refuses anything else', () => {
    expect(isVersionsIndex(bytes('[1]'))).toBe(false)
    expect(isVersionsIndex(bytes('not json'))).toBe(false)
    expect(isVersionsIndex('{}')).toBe(false)
    expect(isVersionsIndex(new Uint8Array(2_000_001))).toBe(false)
  })
})
