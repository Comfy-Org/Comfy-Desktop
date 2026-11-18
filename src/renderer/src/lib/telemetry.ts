export type TelemetryScalar = boolean | number | string | null | undefined
export type TelemetryValue = TelemetryScalar | TelemetryScalar[]
export type TelemetryContext = Record<string, TelemetryValue>

export const TELEMETRY_ACTION_EVENT_NAME = 'launcher-telemetry-action'

export interface TelemetryActionEventDetail {
  actionName: string
  context?: TelemetryContext
}

export function emitTelemetryAction(actionName: string, context: TelemetryContext = {}): void {
  window.dispatchEvent(
    new CustomEvent<TelemetryActionEventDetail>(TELEMETRY_ACTION_EVENT_NAME, {
      detail: { actionName, context }
    })
  )
}

export function toVariantBucket(variantId: string | undefined): string {
  if (!variantId) return 'unknown'
  return variantId.replace(/^(?:beta-)?(win|mac|linux)-/, '')
}

export { bucketError as toErrorBucket } from '../../../shared/errorBucket'

export function toCountBucket(count: number): string {
  if (count <= 0) return '0'
  if (count === 1) return '1'
  if (count <= 2) return '2'
  if (count <= 4) return '3_4'
  if (count <= 9) return '5_9'
  return '10_plus'
}
