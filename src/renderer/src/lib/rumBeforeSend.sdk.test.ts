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

test('the real RUM SDK sends a scrubbed error and drops an error that wraps a cause', async () => {
  captureIntake()
  datadogRum.init({
    applicationId: '00000000-0000-0000-0000-000000000000',
    clientToken: 'pub00000000000000000000000000000000',
    site: 'datadoghq.com',
    proxy: 'https://intake.invalid/rum',
    sessionSampleRate: 100,
    sessionPersistence: 'local-storage',
    beforeSend: (event, context) => {
      if (event.type === 'error') errorsSeenByBeforeSend.push(event.error.message)
      return rumBeforeSend(event, context)
    },
    trackResources: false,
    trackLongTasks: false,
    trackUserInteractions: false,
    allowUntrustedEvents: true
  })

  datadogRum.addError(new Error('plain failure at C:\\Users\\bob\\x'))
  datadogRum.addError(
    new Error('wrapped failure', { cause: new Error('inner failure at C:\\Users\\alice\\x') })
  )
  await vi.waitFor(() => expect(errorsSeenByBeforeSend).toHaveLength(2), {
    timeout: 10_000,
    interval: 50
  })
  hidePage()

  await vi.waitFor(() => expect(sentBodies.join('\n')).toContain('plain failure'), {
    timeout: 10_000,
    interval: 100
  })
  const sent = sentBodies.join('\n')
  expect(sent).toContain('plain failure at C:\\\\Users\\\\[REDACTED]')
  expect(sent).not.toContain('bob')
  expect(sent).not.toContain('wrapped failure')
  expect(sent).not.toContain('alice')
})
