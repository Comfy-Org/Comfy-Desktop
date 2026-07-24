import { app } from 'electron'
import * as mainTelemetry from './telemetry'
import { _broadcastToRenderer } from './ipc/shared'
import type { DatadogForwardedError } from '../../types/ipc'
import { scrubAll } from '../../shared/piiScrub'
import { writeAppLogSync, flushOperationOutput } from './appLog'

/**
 * Main-process error funnel: scrub, fan out to renderer for Datadog RUM,
 * and capture in PostHog Node so nothing is lost when no panel is open.
 */

let processErrorHandlersRegistered = false

function serializeUnknownError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || 'Error',
      stack: error.stack,
    }
  }
  if (typeof error === 'string') {
    return { message: error }
  }
  if (error === null || error === undefined) {
    return { message: 'Unknown error' }
  }
  try {
    return { message: JSON.stringify(error) }
  } catch {
    return { message: String(error) }
  }
}

export function forwardDatadogError(payload: DatadogForwardedError): void {
  const scrubbed: DatadogForwardedError = {
    ...payload,
    message: scrubAll(payload.message),
    stack: payload.stack ? scrubAll(payload.stack) : undefined,
    // Mark as already captured by main-process PostHog so the renderer routes it to Datadog
    // only and we don't double-count in PostHog.
    skipPostHog: true,
  }
  // Broadcast to any open panel renderer to forward to Datadog RUM; no-op when none is open.
  try {
    _broadcastToRenderer('dd-error', scrubbed)
  } catch {}
  // Also capture via PostHog Node so the error isn't lost when no renderer is listening.
  try {
    const err = new Error(scrubbed.message)
    if (scrubbed.stack) err.stack = scrubbed.stack
    mainTelemetry.captureException(err, {
      origin: 'main-process',
      source: scrubbed.source,
      level: scrubbed.level ?? null,
    })
  } catch {}
}

export function registerProcessErrorHandlers(): void {
  if (processErrorHandlersRegistered) return
  processErrorHandlersRegistered = true

  process.on('uncaughtExceptionMonitor', (error) => {
    const serialized = serializeUnknownError(error)
    // Synchronous write first: a buffered stream write would be lost when the
    // process dies before flushing, and this is exactly the cause we need.
    writeAppLogSync(
      'CRITICAL',
      `uncaughtException: ${serialized.message}${serialized.stack ? `\n${serialized.stack}` : ''}`
    )
    // The process is about to die: flush any buffered operation/session tails
    // (install/update/migrate output that hasn't hit a newline) so the last
    // lines before the crash are durable. No-rotate to match the crash path.
    flushOperationOutput(undefined, { rotate: false })
    forwardDatadogError({
      source: 'main-uncaught-exception',
      message: serialized.message,
      stack: serialized.stack,
      level: 'critical',
      context: { origin: 'main-process' },
    })
  })

  process.on('unhandledRejection', (reason) => {
    const serialized = serializeUnknownError(reason)
    writeAppLogSync(
      'ERROR',
      `unhandledRejection: ${serialized.message}${serialized.stack ? `\n${serialized.stack}` : ''}`
    )
    forwardDatadogError({
      source: 'main-unhandled-rejection',
      message: serialized.message,
      stack: serialized.stack,
      level: 'error',
      context: { origin: 'main-process' },
    })
  })

  app.on('child-process-gone', (_event, details) => {
    const extra = details as unknown as Record<string, unknown>
    // Captures GPU / utility / pepper-plugin crashes — native faults that
    // never surface as a JS exception and are a prime suspect for
    // "spontaneously crashes after a few seconds" reports.
    writeAppLogSync(
      details.reason === 'clean-exit' ? 'INFO' : 'ERROR',
      `child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode}` +
        `${extra['name'] ? ` name=${String(extra['name'])}` : ''}` +
        `${extra['serviceName'] ? ` service=${String(extra['serviceName'])}` : ''}`
    )
    forwardDatadogError({
      source: 'main-child-process-gone',
      message: `Child process ${details.type} exited: ${details.reason}`,
      level: 'error',
      context: {
        origin: 'main-process',
        type: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        name: extra['name'],
        serviceName: extra['serviceName'],
      },
    })
  })

  app.on('render-process-gone', (_event, _webContents, details) => {
    // Renderer crashes (Vue UI dying, OOM, integrity failure) are a separate
    // event from child-process-gone and were not previously captured at the
    // app level. `clean-exit` is normal teardown, so don't treat it as a fault.
    if (details.reason === 'clean-exit') return
    writeAppLogSync(
      'CRITICAL',
      `render-process-gone reason=${details.reason} exitCode=${details.exitCode}`
    )
    forwardDatadogError({
      source: 'main-render-process-gone',
      message: `Renderer process gone: ${details.reason} (exit ${details.exitCode})`,
      level: 'critical',
      context: {
        origin: 'main-process',
        reason: details.reason,
        exitCode: details.exitCode,
      },
    })
  })
}
