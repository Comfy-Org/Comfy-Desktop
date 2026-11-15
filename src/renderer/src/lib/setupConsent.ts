import { emitTelemetryAction } from './telemetry'

export interface SetupConsent {
  acceptedTos: boolean
  telemetryEnabled: boolean
  betaFeaturesEnabled: boolean
  betaTouched: boolean
  preservePersistedBetaOptIn: boolean
  locale: string
}

export async function saveSetupConsent(
  consent: Pick<SetupConsent, 'telemetryEnabled' | 'betaFeaturesEnabled' | 'locale'>
): Promise<void> {
  await window.api.setSetting('telemetryEnabled', consent.telemetryEnabled)
  await window.api.setSetting('betaFeaturesEnabled', consent.betaFeaturesEnabled)
  emitTelemetryAction('comfy.desktop.first_use.consent_decision', {
    decision: consent.telemetryEnabled ? 'accept' : 'decline',
    telemetry_enabled: consent.telemetryEnabled,
    locale: consent.locale
  })
}
