import { afterEach, describe, expect, it, vi } from 'vitest'
import { emitTelemetryAction } from './telemetry'
import { initializeRendererBootstrap } from './rendererBootstrap'

function windowApiWithTelemetryOff() {
  const api: Record<string, ReturnType<typeof vi.fn>> = {
    getSetting: vi.fn(async (key: string) => (key === 'telemetryEnabled' ? false : undefined)),
    captureTelemetry: vi.fn()
  }
  return new Proxy(api, {
    get: (target, key: string) => (target[key] ??= vi.fn(() => Promise.resolve(undefined)))
  })
}

describe('renderer telemetry consent gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes only the consent decision and survey answers while telemetry is off', async () => {
    const api = windowApiWithTelemetryOff()
    vi.stubGlobal('api', api)
    initializeRendererBootstrap('title-menu')
    await vi.waitFor(() => expect(api.getSetting).toHaveBeenCalledWith('telemetryEnabled'))

    emitTelemetryAction('comfy.desktop.apps.opened', {})
    emitTelemetryAction('comfy.desktop.first_use.consent_decision', { decision: 'decline' })
    emitTelemetryAction('survey sent', {
      $survey_id: 'survey-id',
      '$survey_response_question-id': 'An app that colors line art'
    })

    expect(api.captureTelemetry!.mock.calls).toEqual([
      ['comfy.desktop.first_use.consent_decision', { decision: 'decline' }],
      [
        'survey sent',
        { $survey_id: 'survey-id', '$survey_response_question-id': 'An app that colors line art' }
      ]
    ])
  })
})
