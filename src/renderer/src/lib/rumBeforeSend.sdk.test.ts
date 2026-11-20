import { expect, test, vi } from 'vitest'
import { datadogRum } from '@datadog/browser-rum'
import { rumBeforeSend } from './datadogPathNormalization'

const sentBodies: string[] = []
const errorsSeenByBeforeSend: string[] = []

async function bodyText(body: unknown): Promise<string> {
  if (typeof body === 'string') return body
  if (body instanceof Blob) return body.text()
  return String(body)
}

function captureIntake(): void {
  vi.spyOn(navigator, 'sendBeacon').mockImplementation((_url, body) => {
    void bodyText(body).then((text) => sentBodies.push(text))
    return true
  })
  vi.spyOn(window, 'fetch').mockImplementation(async (_input, init) => {
    sentBodies.push(await bodyText(init?.body))
    return new Response(null, { status: 202 })
  })
}

function hidePage(): void {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

const PACKAGED_HANDLING_STACK = [
  'Error',
  '  at <anonymous> @ file:///C:/Users/carol/AppData/Local/Programs/ComfyUI/resources/app.asar/out/renderer/assets/rendererBootstrap-x.js:1:2'
].join('\n')

test('the real RUM SDK sends a scrubbed error, and an error that wraps a cause once, flattened and scrubbed', async () => {
  captureIntake()
  datadogRum.init({
    applicationId: '00000000-0000-0000-0000-000000000000',
    clientToken: 'pub00000000000000000000000000000000',
    site: 'datadoghq.com',
    proxy: 'https://intake.invalid/rum',
    sessionSampleRate: 100,
    sessionPersistence: 'local-storage',
    beforeSend: (event, context) => {
      if (event.type === 'error') {
        errorsSeenByBeforeSend.push(event.error.message)
        event.error.handling_stack = PACKAGED_HANDLING_STACK
      }
      return rumBeforeSend(event, context)
    },
    trackResources: false,
    trackLongTasks: false,
    trackUserInteractions: false,
    allowUntrustedEvents: true
  })

  datadogRum.addError(new Error('plain failure at C:\\Users\\bob\\x'))
  const cause = new Error(
    'inner failure at C:\\Users\\alice\\x with password=hunter2 and Authorization: Bearer abcdefghijklmnop'
  )
  cause.stack = [
    'Error: inner failure',
    '    at loadInner (file:///home/bob/plugins/inner-frame.js:3:4)'
  ].join('\n')
  const wrapped = new Error('wrapped failure', { cause })
  wrapped.stack = [
    'Error: wrapped failure',
    '    at load (file:///C:/Users/alice/AppData/Local/Programs/ComfyUI/resources/app.asar/out/renderer/assets/index-x.js:1:2)'
  ].join('\n')
  datadogRum.addError(wrapped, { origin: 'sdk-test-context' })
  await vi.waitFor(() => expect(errorsSeenByBeforeSend).toHaveLength(3), {
    timeout: 10_000,
    interval: 50
  })
  hidePage()

  await vi.waitFor(
    () => {
      const sentSoFar = sentBodies.join('\n')
      expect(sentSoFar).toContain('Caused by')
      expect(sentSoFar).toContain('plain failure')
    },
    {
      timeout: 10_000,
      interval: 100
    }
  )
  const sent = sentBodies.join('\n')
  expect(sent).toContain('plain failure at C:\\\\Users\\\\[REDACTED]')
  expect(sent).not.toContain('bob')
  expect(sent).not.toContain('alice')
  expect(sent).not.toContain('hunter2')
  expect(sent).not.toContain('carol')
  expect(sent).toContain('app://app/renderer/assets/rendererBootstrap-x.js:1:2')
  expect(sent).not.toContain('abcdefghijklmnop')
  expect(sent).toContain('app://app/renderer/assets/index-x.js:1:2')
  expect(sent).toContain('file:///home/[REDACTED]/plugins/inner-frame.js:3:4')
  expect(sent).toContain(
    'wrapped failure\\nCaused by: Error: inner failure at C:\\\\Users\\\\[REDACTED]'
  )
  expect(sent).not.toContain('"causes"')
  expect(sent).toContain('"origin":"sdk-test-context"')
  expect(sent).toContain('"original_error_source":"custom"')
  expect(sent.match(/"message":"wrapped failure/g)).toHaveLength(1)
  expect(errorsSeenByBeforeSend[2]).toContain('Caused by')
})
