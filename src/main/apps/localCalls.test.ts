import { describe, expect, it } from 'vitest'

import {
  MAX_JSON_BODY_CHARS,
  MAX_UPLOAD_BYTES,
  outputFileKey,
  outputFilesOf,
  queueViewOf,
  readLocalCall
} from './localCalls'

const RUN = '0b1c2d3e-aaaa-bbbb-cccc-0123456789ab'
const picture = new Uint8Array([1, 2, 3])

describe('what an app page may ask the ComfyUI on this computer', () => {
  it('reads the queue', () => {
    expect(readLocalCall({ path: '/queue' })).toEqual({ kind: 'queue' })
    expect(readLocalCall({ method: 'GET', path: '/queue' })).toEqual({ kind: 'queue' })
  })

  it('reads how one run went', () => {
    expect(readLocalCall({ path: `/history/${RUN}` })).toEqual({ kind: 'history', promptId: RUN })
  })

  it('reads one result file, in a folder or not', () => {
    const query = new URLSearchParams({
      filename: 'cutout_00001_.png',
      subfolder: 'apps/remove-background',
      type: 'output'
    })

    expect(readLocalCall({ path: `/view?${query}` })).toEqual({
      kind: 'view',
      file: { filename: 'cutout_00001_.png', subfolder: 'apps/remove-background', type: 'output' }
    })
    expect(readLocalCall({ path: '/view?filename=preview.webm&type=temp' })).toEqual({
      kind: 'view',
      file: { filename: 'preview.webm', subfolder: '', type: 'temp' }
    })
  })

  it('reads what one node offers, such as its model files', () => {
    expect(readLocalCall({ path: '/object_info/LoadBackgroundRemovalModel' })).toEqual({
      kind: 'object-info',
      node: 'LoadBackgroundRemovalModel'
    })
  })

  it('reads a run to start, with the tag that names the app in the queue', () => {
    const prompt = { load: { class_type: 'LoadImage', inputs: { image: 'a.png' } } }
    const extraData = { comfy_app: { name: 'Remove Background', seconds: 12 } }
    const body = JSON.stringify({ prompt, client_id: 'the-page', extra_data: extraData })

    expect(readLocalCall({ method: 'POST', path: '/prompt', body })).toEqual({
      kind: 'prompt',
      prompt,
      extraData
    })
    expect(
      readLocalCall({ method: 'POST', path: '/prompt', body: JSON.stringify({ prompt }) })
    ).toEqual({ kind: 'prompt', prompt, extraData: {} })
  })

  it('reads a picture or clip to send', () => {
    expect(
      readLocalCall({
        method: 'POST',
        path: '/upload/image',
        body: picture,
        fileName: 'My_photo-1.PNG'
      })
    ).toEqual({ kind: 'upload', bytes: picture, fileName: 'My_photo-1.PNG' })
    expect(
      readLocalCall({
        method: 'POST',
        path: '/upload/image',
        body: picture.buffer,
        fileName: 'clip.mp4'
      })
    ).toEqual({ kind: 'upload', bytes: picture, fileName: 'clip.mp4' })
  })

  it('reads a run to take out of the queue and a run to stop', () => {
    expect(
      readLocalCall({ method: 'POST', path: '/queue', body: JSON.stringify({ delete: [RUN] }) })
    ).toEqual({ kind: 'leave-queue', promptIds: [RUN] })
    expect(
      readLocalCall({
        method: 'POST',
        path: '/interrupt',
        body: JSON.stringify({ prompt_id: RUN })
      })
    ).toEqual({ kind: 'interrupt', promptId: RUN })
  })
})

describe('what an app page may not ask', () => {
  it.each([
    '/system_stats',
    '/free',
    '/history',
    '/object_info',
    '/userdata/workflows%2Fmine.json',
    '/api/userdata',
    '/internal/logs',
    '/manager/reboot',
    '/extensions',
    '/',
    '',
    'queue',
    '//127.0.0.1:9000/queue',
    'http://127.0.0.1:9000/queue',
    '/history/../userdata',
    '/history/a/b',
    '/object_info/..',
    '/object_info/%2e%2e',
    '/view/../queue',
    '/queue\\..\\free',
    `/history/${RUN}#/free`
  ])('refuses GET %s', (path) => {
    expect(readLocalCall({ path })).toBeNull()
  })

  it.each(['/free', '/history', '/userdata/x', '/upload/mask', '/view', '/object_info/Node'])(
    'refuses POST %s',
    (path) => {
      expect(
        readLocalCall({
          method: 'POST',
          path,
          body: JSON.stringify({ prompt: {}, delete: [RUN], prompt_id: RUN, clear: true })
        })
      ).toBeNull()
    }
  )

  it.each(['PUT', 'DELETE', 'PATCH', 'get', 42, null])('refuses the method %j', (method) => {
    expect(readLocalCall({ method, path: '/queue' })).toBeNull()
  })

  it.each([null, undefined, 'queue', 7, ['/queue'], { path: 7 }, {}])(
    'refuses the malformed request %j',
    (raw) => {
      expect(readLocalCall(raw)).toBeNull()
    }
  )

  it.each([
    '/view',
    '/view?filename=',
    '/view?filename=a%2Fb.png',
    '/view?filename=a.png&subfolder=..%2F..%2Fuser',
    '/view?filename=a.png&subfolder=ok%5C..',
    '/view?filename=a.png&type=input',
    '/view?filename=a.png&type=..'
  ])('refuses the file request %s', (path) => {
    expect(readLocalCall({ path })).toBeNull()
  })

  it('refuses a run that is not a graph', () => {
    const post = (body: unknown) => readLocalCall({ method: 'POST', path: '/prompt', body })

    expect(post(JSON.stringify({ prompt: 'run this' }))).toBeNull()
    expect(post(JSON.stringify({ prompt: [] }))).toBeNull()
    expect(post(JSON.stringify([{ prompt: {} }]))).toBeNull()
    expect(post('{ not json')).toBeNull()
    expect(post({ prompt: {} })).toBeNull()
    expect(post(undefined)).toBeNull()
    expect(post(`{"prompt":{},"pad":"${'x'.repeat(MAX_JSON_BODY_CHARS)}"}`)).toBeNull()
  })

  it('refuses an upload that is empty, too big, or not a picture, clip or sound by name', () => {
    const isRefused = (body: unknown, fileName: unknown): boolean =>
      readLocalCall({ method: 'POST', path: '/upload/image', body, fileName }) === null

    expect(isRefused(picture, 'a.png')).toBe(false)
    expect(isRefused(new Uint8Array(MAX_UPLOAD_BYTES), 'a.png')).toBe(false)
    expect(isRefused(new Uint8Array(MAX_UPLOAD_BYTES + 1), 'a.png')).toBe(true)
    expect(isRefused(new Uint8Array(0), 'a.png')).toBe(true)
    expect(isRefused('not bytes', 'a.png')).toBe(true)
    expect(isRefused(picture, undefined)).toBe(true)
    expect(isRefused(picture, 'run.py')).toBe(true)
    expect(isRefused(picture, 'model.safetensors')).toBe(true)
    expect(isRefused(picture, '../a.png')).toBe(true)
    expect(isRefused(picture, 'folder/a.png')).toBe(true)
    expect(isRefused(picture, '.hidden.png')).toBe(true)
    expect(isRefused(picture, 'a b.png')).toBe(true)
  })

  it('refuses to clear the whole queue or to stop whatever is running', () => {
    const post = (path: string, body: unknown) =>
      readLocalCall({ method: 'POST', path, body: JSON.stringify(body) })

    expect(post('/queue', { clear: true })).toBeNull()
    expect(post('/queue', { delete: [] })).toBeNull()
    expect(post('/queue', { delete: [RUN, 7] })).toBeNull()
    expect(post('/queue', { delete: [RUN, '../x'] })).toBeNull()
    expect(post('/interrupt', {})).toBeNull()
    expect(post('/interrupt', { prompt_id: '' })).toBeNull()
    expect(readLocalCall({ method: 'POST', path: '/interrupt' })).toBeNull()
  })
})

describe('the files a finished run made', () => {
  it('are every file its nodes list, with the folder and kind each is in', () => {
    const entry = {
      status: { completed: true },
      outputs: {
        save: {
          images: [{ filename: 'cutout_00001_.png', subfolder: 'apps', type: 'output' }],
          animated: [false]
        },
        preview: { images: [{ filename: 'p.png', type: 'temp' }, { filename: 7 }, 'junk'] },
        text: { text: ['hello'] },
        broken: null
      }
    }

    expect(outputFilesOf(entry)).toEqual([
      { filename: 'cutout_00001_.png', subfolder: 'apps', type: 'output' },
      { filename: 'p.png', subfolder: '', type: 'temp' }
    ])
  })

  it('are none for a run with no outputs yet', () => {
    expect(outputFilesOf(undefined)).toEqual([])
    expect(outputFilesOf({ status: {} })).toEqual([])
    expect(outputFilesOf({ outputs: [] })).toEqual([])
  })

  it('tell two files apart by kind, folder and name', () => {
    const file = { filename: 'a.png', subfolder: 'x', type: 'output' }

    expect(outputFileKey(file)).toBe(outputFileKey({ ...file }))
    expect(outputFileKey(file)).not.toBe(outputFileKey({ ...file, subfolder: '' }))
    expect(outputFileKey(file)).not.toBe(outputFileKey({ ...file, type: 'temp' }))
    expect(outputFileKey({ filename: 'b', subfolder: 'a/', type: 'output' })).not.toBe(
      outputFileKey({ filename: '/b', subfolder: 'a', type: 'output' })
    )
  })
})

describe('the queue as an app page sees it', () => {
  const someoneElsesGraph = { 3: { class_type: 'KSampler', inputs: { seed: 1 } } }
  const queue = {
    queue_running: [[4, 'other-run', someoneElsesGraph, { client_id: 'their-window' }, ['9']]],
    queue_pending: [
      [6, RUN, { 1: {} }, { comfy_app: { name: 'Remove Background', seconds: 12 } }, []],
      [5, 'tagged-run', { 1: {} }, { comfy_app: { name: 'Upscale', seconds: 90 } }, []],
      'junk'
    ]
  }

  it('shows where its own run stands and what is ahead of it, in order', () => {
    expect(queueViewOf(queue, (id) => id === RUN)).toEqual({
      running: [{ n: 4, id: null, app: null, seconds: null }],
      pending: [
        { n: 5, id: null, app: 'Upscale', seconds: 90 },
        { n: 6, id: RUN, app: 'Remove Background', seconds: 12 }
      ]
    })
  })

  it("never carries another run's id, graph or settings", () => {
    const seen = JSON.stringify(queueViewOf(queue, (id) => id === RUN))

    expect(seen).not.toContain('other-run')
    expect(seen).not.toContain('tagged-run')
    expect(seen).not.toContain('KSampler')
    expect(seen).not.toContain('their-window')
  })

  it('drops an app name too long to be one, and reads an unreadable queue as empty', () => {
    const long = { queue_running: [[1, 'x', {}, { comfy_app: { name: 'n'.repeat(41) } }]] }

    expect(queueViewOf(long, () => false).running).toEqual([
      { n: 1, id: null, app: null, seconds: null }
    ])
    expect(queueViewOf(null, () => true)).toEqual({ running: [], pending: [] })
    expect(queueViewOf({ queue_running: 'no' }, () => true)).toEqual({ running: [], pending: [] })
  })
})
