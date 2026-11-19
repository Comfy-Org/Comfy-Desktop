import { afterEach, describe, expect, it, vi } from 'vitest'
import { datadogRum, type RumErrorEvent } from '@datadog/browser-rum'
import {
  flattenErrorWithCauses,
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

  it('scrubs user paths outside the bundles from the stack and resource URL', () => {
    const event = {
      error: {
        message: 'boom',
        source: 'custom',
        stack: 'Error: boom\n    at C:\\Users\\alice\\plugins\\x.js:1:1',
        resource: {
          method: 'GET',
          status_code: 404,
          url: 'file:///Users/carol/models/z.png'
        }
      }
    } as unknown as RumErrorEvent

    normalizeRumErrorEvent(event)

    expect(event.error.stack).toBe('Error: boom\n    at C:\\Users\\[REDACTED]\\plugins\\x.js:1:1')
    expect(event.error.resource?.url).toBe('file:///Users/[REDACTED]/models/z.png')
  })

  it('updates the stack and resource URL when they point at built bundles', () => {
    const event = {
      error: {
        message: 'boom',
        source: 'custom',
        stack: 'Error: boom\n    at /Applications/ComfyUI/out/preload/index.js:5:2',
        resource: {
          method: 'GET',
          status_code: 500,
          url: 'file:///Users/alice/ComfyUI/out/renderer/assets/index-abc123.js'
        }
      }
    } as unknown as RumErrorEvent

    normalizeRumErrorEvent(event)

    expect(event.error.stack).toContain('app://app/preload/index.js:5:2')
    expect(event.error.resource?.url).toBe('app://app/renderer/assets/index-abc123.js')
  })
})

describe('rumBeforeSend', () => {
  const send = (event: unknown): boolean | undefined =>
    rumBeforeSend(event as Parameters<typeof rumBeforeSend>[0], {} as never) as boolean | undefined

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('drops an error event that carries causes and reports it once, flattened, with its context', () => {
    vi.useFakeTimers()
    const addError = vi.spyOn(datadogRum, 'addError').mockImplementation(() => undefined)
    const event = {
      type: 'error',
      context: { origin: 'renderer' },
      error: {
        message: 'wrapped',
        source: 'console',
        handling: 'unhandled',
        causes: [{ message: 'inner C:\\Users\\alice\\x', source: 'console', type: 'Error' }]
      }
    }

    expect(send(event)).toBe(false)
    expect(addError).not.toHaveBeenCalled()
    vi.runAllTimers()

    expect(addError).toHaveBeenCalledTimes(1)
    const [reported, context] = addError.mock.calls[0] ?? []
    expect((reported as Error).message).toBe(
      'wrapped\nCaused by: Error: inner C:\\Users\\[REDACTED]\\x'
    )
    expect(context).toEqual({
      origin: 'renderer',
      original_error_source: 'console',
      original_error_handling: 'unhandled'
    })
  })

  it('flattens an error and its causes into one scrubbed error without a cause', () => {
    const flattened = flattenErrorWithCauses({
      message: 'wrapped at /home/bob/a',
      source: 'custom',
      type: 'DesktopTelemetryError',
      stack: 'DesktopTelemetryError: wrapped\n  at load @ app://app/renderer/x.js:1:1',
      causes: [
        {
          message:
            'fetch failed with Authorization: Bearer abcdefghijklmnop at C:\\Users\\alice\\x',
          source: 'custom',
          type: 'TypeError',
          stack:
            'TypeError: fetch failed for token=abcdefghijklmnop\n  at <anonymous> @ file:///home/bob/plugins/y.js:2:2'
        },
        { message: '"plain string cause"', source: 'custom' }
      ]
    } as RumErrorEvent['error'])

    expect(flattened.message).toBe(
      [
        'wrapped at /home/[REDACTED]/a',
        'Caused by: TypeError: fetch failed with Authorization: Bearer [REDACTED] at C:\\Users\\[REDACTED]\\x',
        'Caused by: "plain string cause"'
      ].join('\n')
    )
    expect(flattened.stack).toBe(
      [
        'DesktopTelemetryError: wrapped',
        '  at load @ app://app/renderer/x.js:1:1',
        'TypeError: fetch failed for token=[REDACTED]',
        '  at <anonymous> @ file:///home/[REDACTED]/plugins/y.js:2:2'
      ].join('\n')
    )
    expect(flattened.name).toBe('DesktopTelemetryError')
    expect(flattened.cause).toBeUndefined()
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
