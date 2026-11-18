import { app } from 'electron'
import * as mainTelemetry from './telemetry'
import type { DatadogForwardedError } from '../../types/ipc'
import { scrubAll } from '../../shared/piiScrub'
import { writeAppLogSync, flushOperationOutput } from './appLog'

let processErrorHandlersRegistered = false

function serializeUnknownError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || 'Error',
      stack: error.stack
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
    skipPostHog: true
  }
  try {
    const err = new Error(scrubbed.message)
    if (scrubbed.stack) err.stack = scrubbed.stack
    mainTelemetry.captureExceptionAndForward(err, {
      ...(scrubbed.context || {}),
      origin: 'main-process',
      source: scrubbed.source,
      level: scrubbed.level ?? null
    })
  } catch {}
}

export function registerProcessErrorHandlers(): void {
  if (processErrorHandlersRegistered) return
  processErrorHandlersRegistered = true

  process.on('uncaughtExceptionMonitor', (error) => {
    const serialized = serializeUnknownError(error)
    writeAppLogSync(
      'CRITICAL',
      `uncaughtException: ${serialized.message}${serialized.stack ? `\n${serialized.stack}` : ''}`
    )
    flushOperationOutput(undefined, { rotate: false })
    forwardDatadogError({
      source: 'main-uncaught-exception',
      message: serialized.message,
      stack: serialized.stack,
      level: 'critical',
      context: { origin: 'main-process' }
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
      context: { origin: 'main-process' }
    })
  })

  app.on('child-process-gone', (_event, details) => {
    const extra = details as unknown as Record<string, unknown>
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
        serviceName: extra['serviceName']
      }
    })
  })

  app.on('render-process-gone', (_event, _webContents, details) => {
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
        exitCode: details.exitCode
      }
    })
  })
}
