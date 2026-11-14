// @vitest-environment node
import { runInNewContext } from 'vm'
import { describe, expect, it } from 'vitest'

import {
  COMFY_STATE_SCRIPT,
  DEFAULT_WORKFLOW_NAME,
  isApiWorkflow,
  isBuildId,
  isComfyPage,
  MARK_PAGE_STALE_SCRIPT,
  openWorkflowScript,
  readOpenRequest,
  workflowName
} from './openRequest'
import type { OpenRequest } from './openRequest'

const PROMPT = {
  pos: { class_type: 'CLIPTextEncode', inputs: { text: 'a fox', clip: ['clip', 0] } },
  save: { class_type: 'SaveImage', inputs: { images: ['decode', 0] } }
}

function accepted(raw: unknown): OpenRequest {
  const request = readOpenRequest(raw)
  if (typeof request === 'string') throw new Error(`refused: ${request}`)
  return request
}

function page(app: unknown, overlayBusy: string | null = null): Record<string, unknown> {
  return {
    window: { app },
    document: {
      querySelector: () => (overlayBusy === null ? null : { getAttribute: () => overlayBusy })
    }
  }
}

describe('an API-format workflow', () => {
  it('is an object of nodes that each have a class_type and inputs', () => {
    expect(isApiWorkflow({ '1': { class_type: 'SaveImage', inputs: {} } })).toBe(true)
    expect(isApiWorkflow({ '1': { inputs: {} } })).toBe(false)
    expect(isApiWorkflow({ '1': { class_type: '', inputs: {} } })).toBe(false)
    expect(isApiWorkflow({ '1': { class_type: 'SaveImage', inputs: null } })).toBe(false)
    expect(isApiWorkflow({ '1': { class_type: 'SaveImage', inputs: [] } })).toBe(false)
    expect(isApiWorkflow({})).toBe(false)
    expect(isApiWorkflow([])).toBe(false)
    expect(isApiWorkflow(null)).toBe(false)
    expect(isApiWorkflow('alert(1)')).toBe(false)
  })

  it('has at most 500 nodes and fits in 1 MB', () => {
    const nodes = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, i) => [`n${i}`, { class_type: 'X', inputs: {} }])
      )
    expect(isApiWorkflow(nodes(500))).toBe(true)
    expect(isApiWorkflow(nodes(501))).toBe(false)
    expect(isApiWorkflow({ a: { class_type: 'X', inputs: { t: 'a'.repeat(1_100_000) } } })).toBe(
      false
    )
  })
})

describe('a request to open a workflow in ComfyUI', () => {
  it('takes a graph, where it ran and a readable name', () => {
    const name = 'Text to Image - 2026-11-09'
    expect(accepted({ prompt: PROMPT, where: 'local', name })).toEqual({
      prompt: PROMPT,
      where: 'local',
      name
    })
    expect(accepted({ prompt: PROMPT, where: 'cloud', name: '  Same   Face ' })).toMatchObject({
      where: 'cloud',
      name: 'Same Face'
    })
  })

  it('keeps a name written in any language', () => {
    expect(workflowName('文生图 (2026-11-09)')).toBe('文生图 (2026-11-09)')
  })

  it.each([undefined, '', 'a/b', '../x', '<script>', 'x'.repeat(81), 7])(
    'names the workflow after the default when the name is %s',
    (name) => {
      expect(workflowName(name)).toBe(DEFAULT_WORKFLOW_NAME)
    }
  )

  it.each([
    ['nothing', null],
    ['a string', 'x'],
    ['a list', []],
    ['an empty graph', { prompt: {}, where: 'local' }],
    ['a list for a graph', { prompt: [], where: 'local' }],
    ['nodes without a class_type', { prompt: { a: { inputs: {} } }, where: 'local' }],
    ['code for a graph', { prompt: 'alert(1)', where: 'local' }]
  ])('refuses %s as not a workflow', (_what, raw) => {
    expect(readOpenRequest(raw)).toBe('not-a-workflow')
  })

  it.each([undefined, 'browser', 'https://example.com/'])(
    'refuses to open anywhere but Comfy Cloud or this computer (%s)',
    (where) => {
      expect(readOpenRequest({ prompt: PROMPT, where })).toBe('unknown-place')
    }
  )

  it('takes one of the person own builds by id, for this computer only', () => {
    expect(accepted({ prompt: PROMPT, where: 'local', name: 'x', build: 'inst-1731-2' })).toEqual({
      prompt: PROMPT,
      where: 'local',
      name: 'x',
      build: 'inst-1731-2'
    })
    expect(accepted({ prompt: PROMPT, where: 'local', name: 'x' })).not.toHaveProperty('build')
  })

  it.each(['', 'a b', '../inst', 'C:\\x', 'x'.repeat(65), 7, null, {}, ['inst-1']])(
    'refuses a build that is not a plain id (%s)',
    (build) => {
      expect(isBuildId(build)).toBe(false)
      expect(readOpenRequest({ prompt: PROMPT, where: 'local', name: 'x', build })).toBe(
        'unknown-build'
      )
    }
  )

  it('refuses a build given for Comfy Cloud', () => {
    expect(readOpenRequest({ prompt: PROMPT, where: 'cloud', name: 'x', build: 'inst-1' })).toBe(
      'unknown-build'
    )
  })

  it.each(['api_key_comfy_org', 'auth_token_comfy_org', 'API_KEY_COMFY_ORG'])(
    'refuses a graph that carries the Comfy credential input %s',
    (input) => {
      const withKey = { a: { class_type: 'X', inputs: { [input]: 'secret' } } }
      expect(readOpenRequest({ prompt: withKey, where: 'cloud' })).toBe('carries-keys')
    }
  )
})

describe('the script that tells whether ComfyUI has finished starting', () => {
  const idle = { isBusy: false, activeWorkflow: { path: 'workflows/Unsaved Workflow.json' } }
  const app = {
    graph: {},
    canvas: {},
    loadApiJson: () => undefined,
    extensionManager: { spinner: false, workflow: idle }
  }
  const stateOf = (context: Record<string, unknown>): unknown =>
    runInNewContext(COMFY_STATE_SCRIPT, context)

  it('is starting until ComfyUI has its canvas and can load an API workflow', () => {
    expect(stateOf(page(undefined))).toBe('starting')
    expect(stateOf(page({ ...app, canvas: undefined }))).toBe('starting')
    expect(stateOf(page({ ...app, loadApiJson: 1 }))).toBe('starting')
  })

  it('is starting while ComfyUI blocks the page to restore the last session', () => {
    const restoring = { ...app, extensionManager: { spinner: true, workflow: idle } }

    expect(stateOf(page(restoring))).toBe('starting')
    expect(stateOf(page(app, 'true'))).toBe('starting')
  })

  it('is starting while ComfyUI is opening a workflow', () => {
    const opening = {
      ...app,
      extensionManager: { spinner: false, workflow: { ...idle, isBusy: true } }
    }

    expect(stateOf(page(opening))).toBe('starting')
  })

  it('has no workflow until ComfyUI has opened its first one', () => {
    const empty = {
      ...app,
      extensionManager: { spinner: false, workflow: { isBusy: false, activeWorkflow: null } }
    }

    expect(stateOf(page(empty))).toBe('no-workflow')
  })

  it('is ready once ComfyUI is idle with a workflow open, with or without the loading overlay', () => {
    expect(stateOf(page(app))).toBe('ready')
    expect(stateOf(page(app, 'false'))).toBe('ready')
  })

  it('is ready on a ComfyUI that does not say how its start is going', () => {
    expect(stateOf(page({ ...app, extensionManager: undefined }))).toBe('ready')
  })

  it('is never ready on a page Desktop marked as left from an earlier run', () => {
    const context = page(app)

    runInNewContext(MARK_PAGE_STALE_SCRIPT, context)

    expect(stateOf(context)).toBe('starting')
  })
})

describe('the script that loads the workflow into the ComfyUI page', () => {
  const app = { graph: {}, canvas: {}, loadApiJson: () => undefined }

  it('does not open anything in a page with no ComfyUI in it', async () => {
    const request = accepted({ prompt: PROMPT, where: 'local', name: 'x' })

    expect(await runInNewContext(openWorkflowScript(request), page(undefined))).toBe(false)
  })

  it('hands the graph and name to loadApiJson as data, never as code', async () => {
    const asJson = JSON.parse(
      JSON.stringify({
        proto: { class_type: 'CLIPTextEncode', inputs: {} },
        a: {
          class_type: 'CLIPTextEncode',
          inputs: { text: '"});globalThis.hacked=1;//</script>\u2028' }
        }
      }).replace('"proto"', '"__proto__"')
    ) as Record<string, unknown>
    const calls: unknown[][] = []
    const context = page({
      ...app,
      loadApiJson: (...args: unknown[]) => {
        calls.push(args)
      }
    })
    const request = accepted({ prompt: asJson, where: 'local', name: 'Text to Image' })

    expect(await runInNewContext(openWorkflowScript(request), context)).toBe(true)
    expect(JSON.stringify(calls)).toBe(JSON.stringify([[asJson, 'Text to Image']]))
    expect(context['hacked']).toBeUndefined()
  })

  it('says it did not open when ComfyUI refuses or throws on the graph', async () => {
    const request = accepted({ prompt: PROMPT, where: 'local', name: 'x' })
    const refusing = page({ ...app, loadApiJson: () => false })
    const failing = page({ ...app, loadApiJson: () => Promise.reject(new Error('bad graph')) })

    expect(await runInNewContext(openWorkflowScript(request), refusing)).toBe(false)
    expect(await runInNewContext(openWorkflowScript(request), failing)).toBe(false)
  })
})

describe('the ComfyUI page a workflow loads into', () => {
  it.each([
    ['http://127.0.0.1:8188/?x=1', 'http://127.0.0.1:8188', true],
    ['https://cloud.comfy.org/', 'https://cloud.comfy.org/?utm_source=a', true],
    ['data:text/html,splash', 'http://127.0.0.1:8188', false],
    ['http://127.0.0.1:8189/', 'http://127.0.0.1:8188', false],
    ['https://cloud.comfy.org.example.com/', 'https://cloud.comfy.org/', false],
    ['not a url', 'http://127.0.0.1:8188', false]
  ])('%s for a ComfyUI at %s is %s', (pageUrl, comfyUrl, expected) => {
    expect(isComfyPage(pageUrl, comfyUrl)).toBe(expected)
  })
})
