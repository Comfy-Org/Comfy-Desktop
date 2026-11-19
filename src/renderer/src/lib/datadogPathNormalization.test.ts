import { describe, expect, it } from 'vitest'
import type { RumErrorEvent } from '@datadog/browser-rum'
import {
  normalizeDatadogBundlePaths,
  normalizeRumErrorEvent,
  rumBeforeSend,
  scrubRumText
} from './datadogPathNormalization'

describe('normalizeDatadogBundlePaths', () => {
  it('rewrites renderer file URLs to the synthetic Datadog bundle prefix', () => {
    const stack =
      'Error: boom\n    at file:///Users/alice/ComfyUI/out/renderer/assets/index-abc123.js:1:23'

    expect(normalizeDatadogBundlePaths(stack)).toContain(
      'app://app/renderer/assets/index-abc123.js:1:23'
    )
  })

  it('rewrites Windows main-process paths to the synthetic Datadog bundle prefix', () => {
    const stack = 'Error: boom\n    at C:\\Users\\alice\\ComfyUI\\out\\main\\index.js:45:9'

    expect(normalizeDatadogBundlePaths(stack)).toContain('app://app/main/index.js:45:9')
  })

  it('leaves non-bundle URLs unchanged', () => {
    const url = 'https://example.com/app.js'

    expect(normalizeDatadogBundlePaths(url)).toBe(url)
  })
})

describe('scrubRumText', () => {
  it('scrubs a user path with the shared scrubber', () => {
    expect(scrubRumText('C:\\Users\\JohnDoe\\AppData\\Local\\foo')).toBe(
      'C:\\Users\\[REDACTED]\\AppData\\Local\\foo'
    )
  })

  it('redacts the query of a link, where signed links keep their credentials', () => {
    expect(
      scrubRumText(
        "THREE.GLTFLoader: Couldn't load texture https://storage.googleapis.com/b/t.png?X-Goog-Signature=abc&X-Goog-Credential=def"
      )
    ).toBe(
      "THREE.GLTFLoader: Couldn't load texture https://storage.googleapis.com/b/t.png?[REDACTED]"
    )
  })

  it('redacts embedded file content', () => {
    expect(scrubRumText('bad texture data:image/png;base64,iVBORw0KGgo= here')).toBe(
      'bad texture data:[REDACTED] here'
    )
  })
})

describe('normalizeRumErrorEvent', () => {
  it('scrubs a doubled-backslash user path from the error message', () => {
    const event = {
      error: { message: 'open "C:\\\\Users\\\\alice\\\\x" failed', source: 'custom' }
    } as unknown as RumErrorEvent

    normalizeRumErrorEvent(event)

    expect(event.error.message).toBe('open "C:\\\\Users\\\\[REDACTED]\\\\x" failed')
  })

  it('scrubs user paths outside the bundles from the stack, cause stacks, and resource URL', () => {
    const event = {
      error: {
        message: 'boom',
        source: 'custom',
        stack: 'Error: boom\n    at C:\\Users\\alice\\plugins\\x.js:1:1',
        causes: [
          {
            message: 'cause',
            source: 'custom',
            stack: 'Error: cause\n    at /home/bob/plugins/y.js:2:2'
          }
        ],
        resource: {
          method: 'GET',
          status_code: 404,
          url: 'file:///Users/carol/models/z.png'
        }
      }
    } as unknown as RumErrorEvent

    normalizeRumErrorEvent(event)

    expect(event.error.stack).toBe('Error: boom\n    at C:\\Users\\[REDACTED]\\plugins\\x.js:1:1')
    expect(event.error.causes?.[0]?.stack).toBe(
      'Error: cause\n    at /home/[REDACTED]/plugins/y.js:2:2'
    )
    expect(event.error.resource?.url).toBe('file:///Users/[REDACTED]/models/z.png')
  })

  it('updates the main stack, cause stacks, and resource URL when they point at built bundles', () => {
    const event = {
      error: {
        message: 'boom',
        source: 'custom',
        stack: 'Error: boom\n    at /Applications/ComfyUI/out/preload/index.js:5:2',
        causes: [
          {
            message: 'cause',
            source: 'custom',
            stack: 'Error: cause\n    at C:\\ComfyUI\\out\\main\\index.js:8:3'
          }
        ],
        resource: {
          method: 'GET',
          status_code: 500,
          url: 'file:///Users/alice/ComfyUI/out/renderer/assets/index-abc123.js'
        }
      }
    } as unknown as RumErrorEvent

    normalizeRumErrorEvent(event)

    expect(event.error.stack).toContain('app://app/preload/index.js:5:2')
    expect(event.error.causes?.[0]?.stack).toContain('app://app/main/index.js:8:3')
    expect(event.error.resource?.url).toBe('app://app/renderer/assets/index-abc123.js')
  })
})

describe('rumBeforeSend', () => {
  const send = (event: unknown): boolean | undefined =>
    rumBeforeSend(event as Parameters<typeof rumBeforeSend>[0], {} as never) as boolean | undefined

  it('drops an error event that carries causes, since the SDK sends causes as they were', () => {
    const event = {
      type: 'error',
      error: {
        message: 'wrapped',
        source: 'custom',
        causes: [{ message: 'inner C:\\Users\\alice\\x', source: 'custom' }]
      }
    }

    expect(send(event)).toBe(false)
  })

  it('scrubs and keeps an error event without causes', () => {
    const event = {
      type: 'error',
      error: { message: 'open C:\\Users\\alice\\x failed', source: 'custom', causes: [] }
    }

    expect(send(event)).toBe(true)
    expect(event.error.message).toBe('open C:\\Users\\[REDACTED]\\x failed')
  })

  it('keeps other events as they are', () => {
    const event = { type: 'view', view: { url: 'app://app/index.html' } }

    expect(send(event)).toBe(true)
    expect(event.view.url).toBe('app://app/index.html')
  })
})
