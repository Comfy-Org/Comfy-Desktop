// @vitest-environment node
import { runInNewContext } from 'vm'
import { describe, expect, it, vi } from 'vitest'

import {
  isAllowedAppsPermission,
  appsOrigin,
  appsUrl,
  cleanSaveName,
  COMFY_READY_SCRIPT,
  collectOutputs,
  downloadRequest,
  eventFiles,
  fileKey,
  historyFiles,
  inJobGrace,
  interruptJson,
  JOB_GRACE_MS,
  jobsAnswer,
  DEFAULT_APPS_URL,
  isAppOpen,
  isAppsFrameUrl,
  isBuildId,
  isComfyPage,
  isDocumentFailure,
  isInside,
  isPageLoadFailure,
  isRunId,
  isVersionsIndex,
  isWorkflow,
  localEvent,
  localInstalls,
  localRequest,
  noteOwner,
  noteRun,
  noteSubmitted,
  openRequest,
  openWorkflowScript,
  outputKind,
  promptRunId,
  queueAnswer,
  queueJson,
  queueView,
  readable,
  readCapped,
  reconnectDelay,
  requestFile,
  requestRuns,
  type RunSeen,
  safeUploadName,
  saveExt,
  savedFileName,
  textAnswer,
  toOutputFile,
  uploadedFile,
  uploadForm,
  viewQuery,
  workflowName
} from './guards'

describe('appsUrl', () => {
  it('defaults to the hosted site and takes an override in a development build', () => {
    expect(appsUrl({}, false)).toBe(DEFAULT_APPS_URL)
    expect(appsUrl({ COMFY_APPS_URL: 'http://127.0.0.1:5310/' }, false)).toBe(
      'http://127.0.0.1:5310/'
    )
  })

  it('ignores the override in a packaged build', () => {
    expect(appsUrl({ COMFY_APPS_URL: 'https://evil.example/' }, true)).toBe(DEFAULT_APPS_URL)
  })
})

describe('isAppOpen', () => {
  const list = 'https://apps.example/apps/'

  it('is open on an app page or an app route of the list page', () => {
    expect(isAppOpen('https://apps.example/apps/text-to-image/desktop.html', list)).toBe(true)
    expect(isAppOpen('https://apps.example/apps/#/make-image', list)).toBe(true)
  })

  it('is closed on the list itself and on other origins', () => {
    expect(isAppOpen('https://apps.example/apps/', list)).toBe(false)
    expect(isAppOpen('https://apps.example/apps/#/', list)).toBe(false)
    expect(isAppOpen('https://other.example/apps/x/desktop.html', list)).toBe(false)
    expect(isAppOpen('not a url', list)).toBe(false)
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

describe('isAllowedAppsPermission', () => {
  it.each(['clipboard-sanitized-write', 'fullscreen'])('lets an app page use %s', (permission) => {
    expect(isAllowedAppsPermission(permission)).toBe(true)
  })

  it.each(['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal'])(
    'denies %s',
    (permission) => {
      expect(isAllowedAppsPermission(permission)).toBe(false)
    }
  )
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
  it('refuses a file name that is a path', () => {
    expect(toOutputFile({ filename: '../../secret.png', type: 'output' })).toBeNull()
    expect(toOutputFile({ filename: 'a\\b.png', type: 'output' })).toBeNull()
    expect(toOutputFile({ filename: '..', type: 'output' })).toBeNull()
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
  it('keeps a song name', () => {
    expect(safeUploadName('My Song.mp3')).toBe('My_Song.mp3')
    expect(safeUploadName('take.flac')).toBe('take.flac')
    expect(safeUploadName('voice.m4a')).toBe('voice.m4a')
  })
  it('keeps the extension of a long name', () => {
    const name = safeUploadName(`${'a'.repeat(150)}.webm`)
    expect(name).toBe(`${'a'.repeat(95)}.webm`)
  })
})

describe('collectOutputs', () => {
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
    expect(outputKind('hdr.avif')).toBe('image')
    expect(outputKind('master.exr')).toBe('file')
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
    expect(saveExt('avif')).toBe('avif')
    expect(saveExt('EXR')).toBe('exr')
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

describe('localRequest', () => {
  const graph = { '1': { class_type: 'SaveImage', inputs: {} } }

  it('passes the GET paths apps use, rebuilt by main', () => {
    expect(localRequest({ method: 'GET', path: '/system_stats' })).toEqual({
      kind: 'get',
      path: '/system_stats'
    })
    expect(localRequest({ method: 'GET', path: '/object_info/KSampler_Advanced2' })).toEqual({
      kind: 'get',
      path: '/object_info/KSampler_Advanced2'
    })
    expect(localRequest({ method: 'GET', path: '/history/9f1c-ab12' })).toEqual({
      kind: 'get',
      path: '/history/9f1c-ab12'
    })
    expect(
      localRequest({ method: 'GET', path: '/view?filename=a%20b.png&subfolder=apps&type=output' })
    ).toEqual({ kind: 'get', path: '/view?filename=a+b.png&subfolder=apps&type=output' })
  })

  it('refuses other paths, methods and hosts with a 4xx', () => {
    const refused = [
      { method: 'GET', path: '/prompt' },
      { method: 'GET', path: '/queue?x=1' },
      { method: 'GET', path: '/object_info' },
      { method: 'GET', path: '/userdata/workflows%2Fa.json' },
      { method: 'GET', path: '/system_stats/' },
      { method: 'GET', path: '/system_stats?x=1' },
      { method: 'GET', path: '/object_info/Bad%20Name' },
      { method: 'GET', path: '/object_info/Bad.Name' },
      { method: 'GET', path: '/history/' + 'a'.repeat(65) },
      { method: 'GET', path: '/history/a_b' },
      { method: 'POST', path: '/interrupt' },
      { method: 'POST', path: '/interrupt', body: {} },
      { method: 'POST', path: '/queue', body: { clear: true } },
      { method: 'POST', path: '/free' },
      { method: 'DELETE', path: '/history/abc' },
      { method: 'GET', path: '//evil.example/system_stats' },
      { method: 'GET', path: 'system_stats' },
      { method: 'GET', path: 'http://127.0.0.1:8188/system_stats' },
      { method: 'GET' },
      null,
      'GET /system_stats'
    ]
    for (const req of refused) {
      const out = localRequest(req)
      expect(out, JSON.stringify(req)).not.toHaveProperty('kind')
      const status = (out as { status: number }).status
      expect(status).toBeGreaterThanOrEqual(400)
      expect(status).toBeLessThan(500)
    }
    expect(localRequest({ method: 'PUT', path: '/prompt' })).toMatchObject({ status: 405 })
  })

  it('takes a /prompt body as an object or JSON text with a graph in prompt', () => {
    const body = { prompt: graph, client_id: 'c1' }
    const asObject = localRequest({ method: 'POST', path: '/prompt', body })
    expect(asObject).toEqual({ kind: 'prompt', path: '/prompt', json: JSON.stringify(body) })
    const asText = localRequest({ method: 'POST', path: '/prompt', body: JSON.stringify(body) })
    expect(asText).toEqual(asObject)
  })

  it('refuses a /prompt body without a graph, or over 2 MB', () => {
    for (const body of [undefined, 'not json', [], { prompt: 'x' }, { prompt: { '1': {} } }]) {
      expect(localRequest({ method: 'POST', path: '/prompt', body })).toMatchObject({ status: 400 })
    }
    const big = { prompt: graph, extra_data: { pad: 'x'.repeat(2_000_001) } }
    expect(localRequest({ method: 'POST', path: '/prompt', body: big })).toMatchObject({
      status: 400
    })
    expect(localRequest({ method: 'POST', path: '/prompt?x=1', body: { prompt: graph } })).toEqual({
      status: 404,
      error: expect.any(String)
    })
  })

  it('takes an upload as bytes and a cleaned file name, up to 50 MB', () => {
    const bytes = new Uint8Array([1, 2, 3])
    expect(
      localRequest({ method: 'POST', path: '/upload/image', body: bytes, fileName: '../x/cat.png' })
    ).toEqual({ kind: 'upload', path: '/upload/image', bytes, fileName: 'cat.png' })
    expect(
      localRequest({ method: 'POST', path: '/upload/image', body: 'abc', fileName: 'a.png' })
    ).toMatchObject({ status: 400 })
    expect(
      localRequest({
        method: 'POST',
        path: '/upload/image',
        body: new Uint8Array(50_000_001),
        fileName: 'a.png'
      })
    ).toMatchObject({ status: 413 })
  })
})

describe('viewQuery', () => {
  const q = (s: string) => viewQuery(new URLSearchParams(s))

  it('keeps filename, subfolder and type, in that order', () => {
    expect(q('type=temp&filename=a.png')).toBe('filename=a.png&subfolder=&type=temp')
    expect(q('filename=a.png&subfolder=x%2Fy&type=input')).toBe(
      'filename=a.png&subfolder=x%2Fy&type=input'
    )
  })

  it('refuses other keys, repeated keys, other types and paths out of the folder', () => {
    expect(q('filename=a.png&type=output&preview=webp')).toBeNull()
    expect(q('filename=a.png&type=output&channel=rgba')).toBeNull()
    expect(q('filename=a.png&filename=b.png&type=output')).toBeNull()
    expect(q('filename=a.png&type=models')).toBeNull()
    expect(q('filename=a.png')).toBeNull()
    expect(q('type=output')).toBeNull()
    expect(q('filename=..&type=output')).toBeNull()
    expect(q('filename=x%2Fa.png&type=output')).toBeNull()
    expect(q('filename=x%5Ca.png&type=output')).toBeNull()
    expect(q('filename=a.png&subfolder=..%2Fsecret&type=output')).toBeNull()
    expect(q('filename=a.png&subfolder=%2Fetc&type=output')).toBeNull()
    expect(q('filename=a.png&subfolder=C%3A%5Cx&type=output')).toBeNull()
  })
})

describe('uploadForm', () => {
  it('puts the file under image, with overwrite on', async () => {
    const form = uploadForm(new Uint8Array([7, 8]), 'my cat.png')
    const file = form.get('image') as File
    expect(file.name).toBe('my_cat.png')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([7, 8]))
    expect(form.get('overwrite')).toBe('true')
    expect(form.getAll('image')).toHaveLength(1)
    expect(form.getAll('overwrite')).toEqual(['true'])
  })
})

describe('readCapped', () => {
  it('reads an answer up to the cap and drops one over it', async () => {
    expect(await readCapped(new Response(new Uint8Array([1, 2, 3])), 3)).toEqual(
      new Uint8Array([1, 2, 3])
    )
    expect(await readCapped(new Response(new Uint8Array(4)), 3)).toBeNull()
    const declared = new Response('x', { headers: { 'content-length': '10' } })
    expect(await readCapped(declared, 3)).toBeNull()
  })

  it('calls each chunk it reads', async () => {
    const onChunk = vi.fn()
    await readCapped(new Response(new Uint8Array([1, 2, 3])), 3, onChunk)
    expect(onChunk).toHaveBeenCalled()
  })
})

describe('jobs answers after a submit', () => {
  const runId = '11111111-2222-3333-4444-555555555555'
  const pollAt = (submitted: Map<string, number>, status: number, now: number) =>
    jobsAnswer(status, inJobGrace(submitted, runId, now))

  it('keeps polling a 404 inside the grace period and reads the 200 that follows', () => {
    const submitted = new Map<string, number>()
    noteSubmitted(submitted, runId, 1000)
    expect(pollAt(submitted, 404, 1000 + 2_000)).toBe('wait')
    expect(pollAt(submitted, 200, 1000 + 4_000)).toBe('read')
  })

  it('ends the run on a 404 after the grace period', () => {
    const submitted = new Map<string, number>()
    noteSubmitted(submitted, runId, 1000)
    const answer = pollAt(submitted, 404, 1000 + JOB_GRACE_MS)
    expect(answer).toEqual({ error: expect.stringMatching(/cannot find this run/) })
    expect(submitted.has(runId)).toBe(false)
  })

  it('ends the run on a 404 for a run this app did not submit', () => {
    expect(pollAt(new Map(), 404, 1000)).toEqual({ error: expect.any(String) })
  })

  it('names sign-in for 401 and access for 403, even inside the grace period', () => {
    expect(jobsAnswer(401, true)).toEqual({ error: expect.stringMatching(/Sign in again/) })
    expect(jobsAnswer(403, true)).toEqual({ error: expect.stringMatching(/access/) })
  })

  it('refuses other 4xx answers and waits on busy and server errors', () => {
    expect(jobsAnswer(400, true)).toBe('refused')
    expect(jobsAnswer(410, false)).toBe('refused')
    expect(jobsAnswer(429, false)).toBe('wait')
    expect(jobsAnswer(503, false)).toBe('wait')
  })

  it('forgets old submits when a new run starts', () => {
    const submitted = new Map<string, number>([['old', 0]])
    noteSubmitted(submitted, runId, JOB_GRACE_MS + 1)
    expect([...submitted.keys()]).toEqual([runId])
  })
})

describe('textAnswer', () => {
  it('is shaped like a ComfyUI answer', () => {
    const a = textAnswer(404, 'no')
    expect(a.status).toBe(404)
    expect(a.contentType).toMatch(/^text\/plain/)
    expect(new TextDecoder().decode(a.body)).toBe('no')
  })
})

describe('localEvent', () => {
  it('passes the run messages and the queue status', () => {
    const frame = JSON.stringify({ type: 'progress', data: { value: 3, max: 20, prompt_id: 'p' } })
    expect(localEvent(frame)).toEqual({
      type: 'progress',
      data: { value: 3, max: 20, prompt_id: 'p' }
    })
    expect(localEvent(JSON.stringify({ type: 'status', data: { sid: 'c1' } }))).toMatchObject({
      type: 'status'
    })
  })

  it('drops binary previews, other types and text that is not JSON', () => {
    expect(localEvent(new ArrayBuffer(8))).toBeNull()
    expect(localEvent(JSON.stringify({ type: 'crystools.monitor', data: {} }))).toBeNull()
    expect(localEvent(JSON.stringify({ data: {} }))).toBeNull()
    expect(localEvent('not json')).toBeNull()
    expect(localEvent('null')).toBeNull()
  })
})

describe('reconnectDelay', () => {
  it('doubles from 1 s and stops at 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(reconnectDelay)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000
    ])
  })
})

describe('localInstalls', () => {
  const category = (inst: { sourceId: string }) =>
    ({ standalone: 'local', git: 'local', desktop: 'local', cloud: 'cloud', remote: 'remote' })[
      inst.sourceId
    ]

  it('lists local installs, the one launched last first', () => {
    const list = [
      { id: 'a', name: 'A', sourceId: 'standalone', status: 'installed', lastLaunchedAt: 1 },
      { id: 'c', name: 'Cloud', sourceId: 'cloud', lastLaunchedAt: 9 },
      {
        id: 'b',
        name: 'B',
        sourceId: 'git',
        lastLaunchedAt: 9,
        lastLaunchedAtByCategory: { local: 5 }
      },
      { id: 'n', name: 'Never', sourceId: 'standalone', status: 'installed' }
    ]
    expect(localInstalls(list, category).map((i) => i.id)).toEqual(['b', 'a', 'n'])
  })

  it('leaves out legacy Desktop, unfinished and failed installs', () => {
    const list = [
      { id: 'd', name: 'Legacy', sourceId: 'desktop', status: 'installed', lastLaunchedAt: 9 },
      { id: 'i', name: 'Installing', sourceId: 'standalone', status: 'installing' },
      { id: 'f', name: 'Failed', sourceId: 'standalone', status: 'failed' },
      { id: 'r', name: 'Remote', sourceId: 'remote' }
    ]
    expect(localInstalls(list, category)).toEqual([])
  })

  it('leaves out the Apps build, even when it was launched last', () => {
    const list = [
      { id: 'mine', name: 'Mine', sourceId: 'standalone', status: 'installed', lastLaunchedAt: 1 },
      {
        id: 'apps',
        name: 'Apps',
        sourceId: 'standalone',
        status: 'installed',
        appsBuild: true,
        lastLaunchedAt: 9,
        lastLaunchedAtByCategory: { local: 9 }
      }
    ]
    expect(localInstalls(list, category).map((i) => i.id)).toEqual(['mine'])
  })
})

describe('downloadRequest', () => {
  const url = 'https://huggingface.co/org/repo/resolve/main/model.safetensors'
  const ok = { url, folder: 'checkpoints', name: 'model.safetensors' }

  it('passes a Hugging Face model into a known folder', () => {
    expect(downloadRequest(ok)).toEqual(ok)
    expect(downloadRequest({ ...ok, folder: 'upscale_models', name: '4x-Ultra_v2.pth' })).toEqual({
      ...ok,
      folder: 'upscale_models',
      name: '4x-Ultra_v2.pth'
    })
    for (const folder of [
      'controlnet',
      'loras',
      'vae',
      'clip_vision',
      'text_encoders',
      'model_patches',
      'background_removal',
      'frame_interpolation',
      'geometry_estimation',
      'audio_encoders'
    ]) {
      expect(downloadRequest({ ...ok, folder })).not.toHaveProperty('error')
    }
    expect(downloadRequest({ ...ok, folder: 'diffusion_models' })).not.toHaveProperty('error')
  })

  it('refuses other hosts, plain http, ports and credentials', () => {
    for (const bad of [
      'http://huggingface.co/org/repo/resolve/main/model.safetensors',
      'https://huggingface.co.evil.example/x.safetensors',
      'https://evil.example/huggingface.co/x.safetensors',
      'https://cdn-lfs.huggingface.co/x.safetensors',
      'https://huggingface.co:8443/org/repo/x.safetensors',
      'https://user:pass@huggingface.co/org/repo/x.safetensors',
      'https://token@huggingface.co/org/repo/x.safetensors',
      'https://huggingface.co/',
      'file:///etc/passwd',
      'not a url',
      42
    ]) {
      expect(downloadRequest({ ...ok, url: bad }), String(bad)).toHaveProperty('error')
    }
  })

  it('refuses other folders', () => {
    for (const folder of ['custom_nodes', '../checkpoints', 'checkpoints/sub', 'clip', '', 1]) {
      expect(downloadRequest({ ...ok, folder }), String(folder)).toHaveProperty('error')
    }
  })

  it('refuses names that are not plain model files', () => {
    for (const name of [
      'model.ckpt',
      'model.pt',
      'pytorch_model.bin',
      'model.safetensors.exe',
      'model',
      '../model.safetensors',
      'sub/model.safetensors',
      'my model.safetensors',
      '.safetensors',
      '..safetensors',
      'a'.repeat(129) + '.safetensors',
      undefined
    ]) {
      expect(downloadRequest({ ...ok, name }), String(name)).toHaveProperty('error')
    }
  })

  it('refuses a missing request', () => {
    expect(downloadRequest(null)).toHaveProperty('error')
    expect(downloadRequest('x')).toHaveProperty('error')
  })
})

describe('stopping local runs', () => {
  it('passes /interrupt with one run id, as an object or JSON text', () => {
    expect(
      localRequest({ method: 'POST', path: '/interrupt', body: { prompt_id: 'ab-12' } })
    ).toEqual({ kind: 'json', path: '/interrupt', json: '{"prompt_id":"ab-12"}' })
    expect(interruptJson('{"prompt_id":"ab-12"}')).toBe('{"prompt_id":"ab-12"}')
  })

  it('refuses an /interrupt that would stop whatever runs, or carries more', () => {
    for (const body of [
      undefined,
      {},
      { prompt_id: '' },
      { prompt_id: 'a b' },
      { prompt_id: 'a'.repeat(65) },
      { prompt_id: 7 },
      { prompt_id: 'ab', extra: 1 },
      [],
      'not json',
      JSON.stringify({ prompt_id: 'ab', pad: 'x'.repeat(10_001) })
    ]) {
      expect(interruptJson(body), JSON.stringify(body)).toBeNull()
    }
    expect(
      localRequest({ method: 'POST', path: '/interrupt?x=1', body: { prompt_id: 'a' } })
    ).toMatchObject({ status: 404 })
  })

  it('passes /queue deleting up to 50 run ids', () => {
    expect(
      localRequest({ method: 'POST', path: '/queue', body: { delete: ['a1', 'b-2'] } })
    ).toEqual({ kind: 'json', path: '/queue', json: '{"delete":["a1","b-2"]}' })
    const fifty = Array.from({ length: 50 }, (_, i) => `id-${i}`)
    expect(queueJson({ delete: fifty })).toBe(JSON.stringify({ delete: fifty }))
  })

  it('refuses a /queue clear, other keys, bad ids and more than 50', () => {
    for (const body of [
      { clear: true },
      { delete: ['a'], clear: true },
      { delete: [] },
      { delete: 'a' },
      { delete: ['a', 'b c'] },
      { delete: ['a', 3] },
      { delete: Array.from({ length: 51 }, (_, i) => `id-${i}`) },
      {}
    ]) {
      expect(queueJson(body), JSON.stringify(body)).toBeNull()
    }
  })

  it('leaves /free to Desktop: a page cannot unload models', () => {
    for (const body of [undefined, {}, { unload_models: true, free_memory: true }]) {
      expect(localRequest({ method: 'POST', path: '/free', body })).toMatchObject({ status: 404 })
    }
    expect(localRequest({ method: 'GET', path: '/free' })).toMatchObject({ status: 404 })
  })
})

describe('apps page load failures', () => {
  it('counts a failed main-frame load, but not one replaced by another navigation', () => {
    expect(isPageLoadFailure(-105)).toBe(true)
    expect(isPageLoadFailure(-106)).toBe(true)
    expect(isPageLoadFailure(-3)).toBe(false)
    expect(isPageLoadFailure(0)).toBe(false)
  })

  it('counts a main document that is not 2xx', () => {
    expect([200, 204, 299].map(isDocumentFailure)).toEqual([false, false, false])
    expect([404, 500, 503, 199, 304].map(isDocumentFailure)).toEqual([true, true, true, true, true])
    expect(isDocumentFailure(-1)).toBe(false)
    expect(isDocumentFailure(0)).toBe(false)
  })
})

describe('opening a workflow in ComfyUI', () => {
  const prompt = {
    pos: { class_type: 'CLIPTextEncode', inputs: { text: 'a fox', clip: ['clip', 0] } },
    save: { class_type: 'SaveImage', inputs: { images: ['decode', 0] } }
  }

  it('takes a graph, where it ran and a readable name', () => {
    expect(openRequest({ prompt, where: 'local', name: 'Text to Image - 2026-11-09' })).toEqual({
      prompt,
      where: 'local',
      name: 'Text to Image - 2026-11-09'
    })
    expect(openRequest({ prompt, where: 'cloud', name: '  Same   Face ' })).toMatchObject({
      where: 'cloud',
      name: 'Same Face'
    })
  })

  it('names it Comfy app when the name is odd', () => {
    for (const name of [undefined, '', 'a/b', '../x', '<script>', 'x'.repeat(81), 7]) {
      expect(workflowName(name), String(name)).toBe('Comfy app')
    }
  })

  it('refuses anything but a graph opened on Comfy Cloud or this computer', () => {
    for (const input of [
      null,
      'x',
      [],
      { prompt, where: 'browser' },
      { prompt, where: 'https://evil.example/' },
      { prompt: {}, where: 'local' },
      { prompt: [], where: 'local' },
      { prompt: { a: { inputs: {} } }, where: 'local' },
      { prompt: 'alert(1)', where: 'local' }
    ]) {
      expect(openRequest(input), JSON.stringify(input)).toHaveProperty('error')
    }
  })

  it('takes one of the person own builds by id, for a This computer run only', () => {
    expect(openRequest({ prompt, where: 'local', name: 'x', build: 'inst-1731-2' })).toMatchObject({
      where: 'local',
      build: 'inst-1731-2'
    })
    expect(openRequest({ prompt, where: 'local', name: 'x' })).not.toHaveProperty('build')
  })

  it('refuses a build that is not a plain id, or one given for Comfy Cloud', () => {
    for (const build of ['', 'a b', '../inst', 'x'.repeat(65), 7, null, {}, ['inst-1']]) {
      expect(
        openRequest({ prompt, where: 'local', name: 'x', build }),
        String(build)
      ).toHaveProperty('error')
    }
    expect(openRequest({ prompt, where: 'cloud', name: 'x', build: 'inst-1' })).toHaveProperty(
      'error'
    )
    expect(isBuildId('inst-1731-2')).toBe(true)
    expect(isBuildId('C:\\x')).toBe(false)
  })

  it('refuses more than 500 nodes or a graph over 1 MB', () => {
    const many = Object.fromEntries(
      Array.from({ length: 501 }, (_, i) => [`n${i}`, { class_type: 'X', inputs: {} }])
    )
    expect(openRequest({ prompt: many, where: 'local' })).toHaveProperty('error')
    const big = { a: { class_type: 'X', inputs: { t: 'a'.repeat(1_100_000) } } }
    expect(openRequest({ prompt: big, where: 'cloud' })).toHaveProperty('error')
  })

  it('refuses a graph that carries a Comfy key or token', () => {
    for (const key of ['api_key_comfy_org', 'auth_token_comfy_org']) {
      const withKey = { a: { class_type: 'X', inputs: { [key]: 'secret' } } }
      expect(openRequest({ prompt: withKey, where: 'cloud' })).toHaveProperty('error')
    }
  })

  function page(app: unknown, busy = 'false') {
    return {
      window: { app },
      document: { querySelector: () => ({ getAttribute: () => busy }) },
      Promise
    }
  }

  it('waits until ComfyUI has its canvas and has finished starting', () => {
    const app = { graph: {}, canvas: {}, loadApiJson: () => {} }
    expect(runInNewContext(COMFY_READY_SCRIPT, page(undefined))).toBe(false)
    expect(runInNewContext(COMFY_READY_SCRIPT, page({ ...app, canvas: undefined }))).toBe(false)
    expect(runInNewContext(COMFY_READY_SCRIPT, page(app, 'true'))).toBe(false)
    expect(runInNewContext(COMFY_READY_SCRIPT, page(app))).toBe(true)
  })

  it('hands the graph to loadApiJson as data, never as code', async () => {
    const sneaky = {
      a: {
        class_type: 'CLIPTextEncode',
        inputs: { text: '"});globalThis.hacked=1;//</script>\u2028' }
      }
    }
    const req = openRequest({ prompt: sneaky, where: 'local', name: 'Text to Image' })
    if ('error' in req) throw new Error(req.error)
    const calls: unknown[][] = []
    const app = {
      graph: {},
      canvas: {},
      loadApiJson: (...args: unknown[]) => {
        calls.push(args)
      }
    }
    const ctx = page(app) as Record<string, unknown>
    expect(await runInNewContext(openWorkflowScript(req), ctx)).toBe(true)
    expect(calls).toEqual([[sneaky, 'Text to Image']])
    expect(ctx['hacked']).toBeUndefined()
  })

  it('says it did not open when ComfyUI refuses the graph', async () => {
    const req = openRequest({ prompt, where: 'local', name: 'x' })
    if ('error' in req) throw new Error(req.error)
    const app = { graph: {}, canvas: {}, loadApiJson: () => false }
    expect(await runInNewContext(openWorkflowScript(req), page(app))).toBe(false)
  })

  it('loads only into the ComfyUI page itself', () => {
    expect(isComfyPage('http://127.0.0.1:8188/?x=1', 'http://127.0.0.1:8188')).toBe(true)
    expect(isComfyPage('https://cloud.comfy.org/', 'https://cloud.comfy.org/?utm_source=a')).toBe(
      true
    )
    expect(isComfyPage('data:text/html,splash', 'http://127.0.0.1:8188')).toBe(false)
    expect(isComfyPage('http://127.0.0.1:8189/', 'http://127.0.0.1:8188')).toBe(false)
    expect(isComfyPage('https://cloud.comfy.org.evil.com/', 'https://cloud.comfy.org/')).toBe(false)
    expect(isComfyPage('not a url', 'http://127.0.0.1:8188')).toBe(false)
  })
})

describe('reading the local queue', () => {
  const graph = { '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'secret' } } }
  const item = (n: number, id: unknown, extra: unknown) => [
    n,
    id,
    graph,
    extra,
    ['1'],
    { auth_token_comfy_org: 'k' }
  ]

  it('passes GET /queue with no query', () => {
    expect(localRequest({ method: 'GET', path: '/queue' })).toEqual({
      kind: 'queue',
      path: '/queue'
    })
  })

  it('keeps only run ids, their order and the app tag, never graphs or extra data', () => {
    const raw = {
      queue_running: [
        item(3, 'run-a', {
          client_id: 'c',
          comfy_app: { name: 'Rotoscope', seconds: 420.4 },
          extra_pnginfo: { workflow: graph }
        })
      ],
      queue_pending: [
        item(9, 'run-c', { comfy_app: { name: 'Doodle to image', seconds: 30 } }),
        item(5, 'run-b', { client_id: 'other' })
      ]
    }
    const view = queueView(raw)
    expect(view).toEqual({
      running: [{ id: 'run-a', app: 'Rotoscope', seconds: 420 }],
      pending: [
        { id: 'run-b', app: null, seconds: null },
        { id: 'run-c', app: 'Doodle to image', seconds: 30 }
      ]
    })
    const text = JSON.stringify(view)
    for (const leak of [
      'secret',
      'SaveImage',
      'client_id',
      'extra_pnginfo',
      'auth_token',
      'other'
    ]) {
      expect(text, leak).not.toContain(leak)
    }
  })

  it('drops app tags that are not a short plain name or a sane number of seconds', () => {
    for (const comfy_app of [
      { name: '<b>x</b>', seconds: -1 },
      { name: 'a'.repeat(41), seconds: 86_401 },
      { name: 7, seconds: '60' },
      'Rotoscope',
      null
    ]) {
      const view = queueView({ queue_running: [item(1, 'r', { comfy_app })] })
      expect(view.running[0], JSON.stringify(comfy_app)).toEqual({
        id: 'r',
        app: null,
        seconds: null
      })
    }
  })

  it('counts runs with odd ids without naming them, and reads a broken queue as empty', () => {
    const view = queueView({ queue_running: [], queue_pending: [item(1, 'a b', {}), 'x'] })
    expect(view.pending).toEqual([{ id: '', app: null, seconds: null }])
    expect(queueView(null)).toEqual({ running: [], pending: [] })
    expect(queueView({ queue_running: 'x' })).toEqual({ running: [], pending: [] })
  })

  it('caps each list at 100 runs', () => {
    const many = Array.from({ length: 150 }, (_, i) => item(i, `r${i}`, {}))
    expect(queueView({ queue_pending: many }).pending).toHaveLength(100)
  })

  it('adds when a run started and its progress, from the socket', () => {
    const seen = new Map<string, RunSeen>()
    noteRun(seen, { type: 'execution_start', data: { prompt_id: 'run-a' } }, 1000)
    noteRun(seen, { type: 'progress', data: { prompt_id: 'run-a', value: 12, max: 30 } }, 2000)
    const view = queueView({ queue_running: [item(1, 'run-a', {})] }, seen)
    expect(view.running[0]).toEqual({
      id: 'run-a',
      app: null,
      seconds: null,
      startedAt: 1000,
      done: 12,
      of: 30
    })
  })

  it('forgets a run when it ends, ignores progress for runs it did not see start, and keeps 50', () => {
    const seen = new Map<string, RunSeen>()
    noteRun(seen, { type: 'progress', data: { prompt_id: 'x', value: 1, max: 2 } }, 1)
    expect(seen.size).toBe(0)
    noteRun(seen, { type: 'execution_start', data: { prompt_id: 'x' } }, 1)
    noteRun(seen, { type: 'progress', data: { prompt_id: 'x', value: 'a', max: 0 } }, 2)
    expect(seen.get('x')).toEqual({ startedAt: 1 })
    noteRun(seen, { type: 'execution_success', data: { prompt_id: 'x' } }, 3)
    expect(seen.size).toBe(0)
    for (let i = 0; i < 60; i++)
      noteRun(seen, { type: 'execution_start', data: { prompt_id: `r${i}` } }, i)
    expect(seen.size).toBe(50)
    expect(seen.has('r0')).toBe(false)
    expect(seen.has('r59')).toBe(true)
    noteRun(seen, { type: 'execution_start', data: { prompt_id: 'a b' } }, 1)
    expect(seen.has('a b')).toBe(false)
  })

  it('answers the cut-down queue as JSON, and refuses what ComfyUI did not answer well', () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ queue_running: [item(1, 'r', {})], queue_pending: [] })
    )
    const ok = queueAnswer(200, bytes, new Map())
    expect(ok.status).toBe(200)
    expect(ok.contentType).toBe('application/json')
    expect(JSON.parse(new TextDecoder().decode(ok.body))).toEqual({
      running: [{ id: 'r', app: null, seconds: null }],
      pending: []
    })
    expect(queueAnswer(500, bytes, new Map()).status).toBe(500)
    expect(queueAnswer(500, bytes, new Map()).body).not.toEqual(bytes)
    expect(queueAnswer(200, new TextEncoder().encode('not json'), new Map()).status).toBe(502)
  })
})

describe('which runs and files a local request touches', () => {
  const ask = (input: unknown) => {
    const req = localRequest(input)
    if (!('kind' in req)) throw new Error(req.error)
    return req
  }

  it('names the run a history read, an interrupt or a queue removal is about', () => {
    expect(requestRuns(ask({ method: 'GET', path: '/history/ab-1' }))).toEqual(['ab-1'])
    expect(
      requestRuns(ask({ method: 'POST', path: '/interrupt', body: { prompt_id: 'ab-1' } }))
    ).toEqual(['ab-1'])
    expect(
      requestRuns(ask({ method: 'POST', path: '/queue', body: { delete: ['a', 'b'] } }))
    ).toEqual(['a', 'b'])
    expect(requestRuns(ask({ method: 'GET', path: '/queue' }))).toEqual([])
    expect(requestRuns(ask({ method: 'GET', path: '/system_stats' }))).toEqual([])
  })

  it('names the file a view reads', () => {
    const req = ask({ method: 'GET', path: '/view?filename=a.png&subfolder=apps&type=output' })
    expect(requestFile(req)).toBe(fileKey({ filename: 'a.png', subfolder: 'apps', type: 'output' }))
    expect(requestFile(ask({ method: 'GET', path: '/history/ab-1' }))).toBeNull()
  })
})

describe('what ComfyUI says apps made', () => {
  const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v))

  it('reads the run id a queued prompt got', () => {
    expect(promptRunId(bytes({ prompt_id: 'ab-1', number: 3 }))).toBe('ab-1')
    expect(promptRunId(bytes({ error: 'x' }))).toBeNull()
    expect(promptRunId(new TextEncoder().encode('not json'))).toBeNull()
  })

  it('reads the input file an upload kept', () => {
    expect(uploadedFile(bytes({ name: 'p.png', subfolder: '', type: 'input' }))).toBe(
      fileKey({ filename: 'p.png', subfolder: '', type: 'input' })
    )
    expect(uploadedFile(bytes({}))).toBeNull()
  })

  it('reads the output files of one run from its history', () => {
    const history = {
      r1: {
        outputs: { '9': { images: [{ filename: 'a.png', subfolder: 'apps', type: 'output' }] } }
      }
    }
    expect(historyFiles(bytes(history), 'r1')).toEqual([
      fileKey({ filename: 'a.png', subfolder: 'apps', type: 'output' })
    ])
    expect(historyFiles(bytes(history), 'r2')).toEqual([])
  })

  it('reads the files an executed event names', () => {
    const msg = {
      type: 'executed',
      data: {
        prompt_id: 'r1',
        node: '9',
        output: { images: [{ filename: 'a.png', type: 'temp' }] }
      }
    }
    expect(eventFiles(msg)).toEqual({
      runId: 'r1',
      files: [fileKey({ filename: 'a.png', subfolder: '', type: 'temp' })]
    })
    expect(eventFiles({ type: 'progress', data: { prompt_id: 'r1' } })).toBeNull()
  })

  it('keeps only the newest owners', () => {
    const owners = new Map<string, string>()
    for (let i = 0; i < 5; i++) noteOwner(owners, `r${i}`, 'x', 3)
    expect([...owners.keys()]).toEqual(['r2', 'r3', 'r4'])
  })

  it('hides the queued runs apps do not own but keeps their place', () => {
    const raw = {
      queue_running: [[0, 'theirs', {}, { comfy_app: { name: 'Mine' } }, []]],
      queue_pending: [[1, 'ours', {}, {}, []]]
    }
    expect(queueView(raw, new Map(), (id) => id === 'ours')).toEqual({
      running: [{ id: '', app: null, seconds: null }],
      pending: [{ id: 'ours', app: null, seconds: null }]
    })
  })
})
