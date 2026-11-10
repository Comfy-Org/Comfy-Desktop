import { datadogRum, type RumBeforeSend } from '@datadog/browser-rum'
import { normalizeRumErrorEvent } from './datadogPathNormalization'
import {
  TELEMETRY_ACTION_EVENT_NAME,
  type TelemetryActionEventDetail,
  type TelemetryContext
} from './telemetry'
import { normalizeExceptionContext, scrubAll } from '../../../shared/piiScrub'
import { ERROR_MESSAGE_MAX, ERROR_STACK_MAX } from '../../../shared/errorEvent'
import { sessionKindOf } from '../../../shared/performanceTestSession'
import {
  isDatadogMirroredEvent,
  stripDatadogDroppedKeys,
  type RendererCohortContextKey
} from '../../../shared/datadogMirroredEvents'

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

function parseSampleRate(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, parsed))
}

function isFlagDisabled(value: string | undefined): boolean {
  return ['0', 'false', 'off'].includes((value || '').trim().toLowerCase())
}

type DatadogTrackingConsent = 'granted' | 'not-granted'

const DEFAULT_DATADOG_APPLICATION_ID = '74a97924-20d7-4890-8e55-0c2b87193373'
const DEFAULT_DATADOG_CLIENT_TOKEN = 'pub5b0afc7fe0411fcebad80bb87274d711'
const DEFAULT_DATADOG_SERVICE = 'comfyui-desktop-2'

const datadogClientToken = (
  import.meta.env.VITE_DATADOG_RUM_CLIENT_TOKEN || DEFAULT_DATADOG_CLIENT_TOKEN
).trim()
const datadogApplicationId = (
  import.meta.env.VITE_DATADOG_RUM_APPLICATION_ID || DEFAULT_DATADOG_APPLICATION_ID
).trim()
const datadogSite = (import.meta.env.VITE_DATADOG_RUM_SITE || 'us5.datadoghq.com').trim()
const datadogService = (import.meta.env.VITE_DATADOG_RUM_SERVICE || DEFAULT_DATADOG_SERVICE).trim()
const datadogEnv = (import.meta.env.VITE_DATADOG_RUM_ENV || 'prod-v2').trim()
const datadogVersion = (import.meta.env.VITE_DATADOG_RUM_VERSION || '').trim()

const isDatadogConfigured =
  !isFlagDisabled(import.meta.env.VITE_DATADOG_RUM_ENABLED) &&
  datadogClientToken.length > 0 &&
  datadogApplicationId.length > 0

let isDatadogInitialized = false
let bootstrapInvoked = false

const datadogBeforeSend: RumBeforeSend = (event) => {
  if (event.type === 'error') {
    normalizeRumErrorEvent(event)
  }
  return true
}

function toDatadogTrackingConsent(enabled: boolean | undefined): DatadogTrackingConsent {
  return enabled === true ? 'granted' : 'not-granted'
}

async function getTelemetryEnabledSetting(): Promise<boolean | undefined> {
  try {
    return (await window.api.getSetting('telemetryEnabled')) as boolean | undefined
  } catch {
    return undefined
  }
}

function setDatadogTrackingConsent(consent: DatadogTrackingConsent): void {
  if (!isDatadogInitialized) return
  try {
    datadogRum.setTrackingConsent(consent)
  } catch {}
}

export type RendererRole = 'title-bar' | 'title-menu' | 'panel'

let rendererRole: RendererRole = 'panel'

let resolvedTelemetryEnabled: boolean | undefined = undefined

const PRE_CONSENT_ALLOWED_EVENTS: ReadonlySet<string> = new Set([
  'comfy.desktop.first_use.consent_decision'
])
const RENDERER_TELEMETRY_EVENT_CAP = 5_000
let rendererTelemetryEventsEmitted = 0

function claimRendererTelemetryBudget(event: string): boolean {
  if (
    event === 'comfy.desktop.telemetry.rate_limited' ||
    event === 'comfy.desktop.telemetry.session_cap_hit'
  )
    return true
  if (rendererTelemetryEventsEmitted >= RENDERER_TELEMETRY_EVENT_CAP) return false
  rendererTelemetryEventsEmitted++
  return true
}

function isTelemetryEmitAllowed(actionName: string): boolean {
  if (resolvedTelemetryEnabled === true) return true
  return PRE_CONSENT_ALLOWED_EVENTS.has(actionName)
}

function scrubTelemetryContext(context: TelemetryContext): TelemetryContext {
  let mutated: TelemetryContext | null = null
  for (const key of Object.keys(context)) {
    const value = context[key]
    if (typeof value === 'string') {
      const cleaned = scrubAll(value)
      if (cleaned === value) continue
      if (!mutated) mutated = { ...context }
      mutated[key] = cleaned
    } else if (Array.isArray(value)) {
      const cleaned = value.map((entry) => (typeof entry === 'string' ? scrubAll(entry) : entry))
      if (cleaned.every((entry, index) => entry === value[index])) continue
      if (!mutated) mutated = { ...context }
      mutated[key] = cleaned
    }
  }
  return mutated ?? context
}

const MAX_TELEMETRY_JSON_LENGTH = 768 * 1024

function serializeForTelemetry(value: unknown): { json: string | null; truncated: boolean } {
  const json = JSON.stringify(value)
  if (json.length > MAX_TELEMETRY_JSON_LENGTH) return { json: null, truncated: true }
  return { json, truncated: false }
}

function trackTelemetryAction(
  actionName: string,
  context: TelemetryContext,
  options: { skipPostHog?: boolean } = {}
): void {
  if (!isTelemetryEmitAllowed(actionName)) return
  const scrubbed = scrubTelemetryContext(context)
  if (!options.skipPostHog) {
    try {
      window.api.captureTelemetry(actionName, scrubbed)
    } catch {}
    return
  }
  if (!claimRendererTelemetryBudget(actionName)) return
  if (isDatadogInitialized && isDatadogMirroredEvent(actionName)) {
    try {
      datadogRum.addAction(actionName, stripDatadogDroppedKeys(scrubbed))
    } catch {}
  }
}

function handleTelemetryActionBridgeEvent(event: Event): void {
  const detail = (event as CustomEvent<unknown>).detail as TelemetryActionEventDetail | undefined
  if (!detail || typeof detail !== 'object') return
  if (typeof detail.actionName !== 'string' || detail.actionName.length === 0) return
  const context = detail.context && typeof detail.context === 'object' ? detail.context : {}
  trackTelemetryAction(detail.actionName, context)
}

function deriveAppChannel(appVersion: string): string {
  if (!appVersion) return 'unknown'
  const v = appVersion.toLowerCase()
  if (v.includes('-beta')) return 'beta'
  if (v.includes('-canary')) return 'canary'
  if (v.includes('-alpha')) return 'alpha'
  return 'stable'
}

async function registerCohortContext(opts: {
  appVersion: string
  telemetryEnabled: boolean
}): Promise<void> {
  const appChannel = deriveAppChannel(opts.appVersion)
  const locale = await window.api.getLocale().catch(() => 'unknown')
  const theme = await window.api
    .getSetting('theme')
    .then((v) => (typeof v === 'string' && v ? v : 'unknown'))
    .catch(() => 'unknown')
  const firstUseCompleted = await window.api
    .getSetting('firstUseCompleted')
    .then((v) => (typeof v === 'boolean' ? v : null))
    .catch(() => null)
  const installSummary = await window.api.getInstallationsSummary().catch(() => null)

  const cohort: Record<RendererCohortContextKey, string | number | boolean | null> = {
    app_version: opts.appVersion || 'unknown',
    app_channel: appChannel,
    locale,
    theme,
    telemetry_enabled: opts.telemetryEnabled,
    first_use_completed: firstUseCompleted,
    local_installation_count: installSummary?.localCount ?? null,
    has_launched_cloud: installSummary?.hasLaunchedCloud ?? null,
    has_legacy_install: installSummary?.hasLegacyDesktop ?? null
  }

  if (isDatadogInitialized) {
    try {
      for (const [key, value] of Object.entries(cohort)) {
        datadogRum.setGlobalContextProperty(key, value)
      }
    } catch {}
  }
  try {
    window.api.registerTelemetryProperties(cohort)
  } catch {}
}

async function initializeProviders(): Promise<void> {
  const telemetryEnabled = await getTelemetryEnabledSetting()
  resolvedTelemetryEnabled = telemetryEnabled
  const consent = telemetryEnabled !== false
  const appVersion = datadogVersion || 'unknown'

  if (isDatadogConfigured) {
    try {
      datadogRum.init({
        applicationId: datadogApplicationId,
        clientToken: datadogClientToken,
        site: datadogSite,
        service: datadogService,
        env: datadogEnv,
        version: datadogVersion || undefined,
        trackingConsent: toDatadogTrackingConsent(telemetryEnabled),
        beforeSend: datadogBeforeSend,
        sessionSampleRate: parseSampleRate(
          import.meta.env.VITE_DATADOG_RUM_SESSION_SAMPLE_RATE,
          100
        ),
        sessionPersistence: 'local-storage',
        trackResources: false,
        trackLongTasks: false,
        trackUserInteractions: false
      })
      isDatadogInitialized = true
      try {
        datadogRum.setGlobalContextProperty('renderer_role', rendererRole)
      } catch {}
    } catch {}
  }

  void registerCohortContext({ appVersion, telemetryEnabled: consent })
  window.api
    .getDeviceId()
    .then((id) => {
      if (isDatadogInitialized) {
        try {
          datadogRum.setUser({ id })
        } catch {}
      }
    })
    .catch(() => {})

  if (rendererRole === 'panel') {
    window.api
      .getInstallsInventory()
      .then((inventory) => {
        if (!inventory) return
        if (!isTelemetryEmitAllowed('comfy.desktop.session.installs_inventory')) return
        const installsJson = serializeForTelemetry(inventory.installs)
        try {
          window.api.captureTelemetry('comfy.desktop.session.installs_inventory', {
            total_install_count: inventory.total_install_count,
            included_install_count: inventory.included_install_count,
            truncated: inventory.truncated,
            installs_json: installsJson.json,
            installs_json_truncated: installsJson.truncated
          })
        } catch {}
      })
      .catch(() => {})
  }

  window.api
    .getSystemInfo()
    .then((info) => {
      const gpuDriverVersion =
        info.nvidia_driver_version ?? info.amd_driver_version ?? info.intel_driver_version ?? null
      const { gpus, installations, ...infoRest } = info
      const gpusJson = serializeForTelemetry(gpus)
      const installationsJson = serializeForTelemetry(installations)
      const enriched: Record<string, string | number | boolean | null | undefined> = {
        ...(infoRest as unknown as Record<string, string | number | boolean | null | undefined>),
        gpu_count: gpus.length,
        gpu_driver_version: gpuDriverVersion,
        gpus_json: gpusJson.json,
        gpus_json_truncated: gpusJson.truncated,
        installations_json: installationsJson.json,
        installations_json_truncated: installationsJson.truncated
      }
      if (rendererRole === 'panel') {
        trackTelemetryAction('comfy.desktop.session.system_info', enriched)
      }
      try {
        window.api.registerTelemetryProperties({
          platform: info.platform,
          arch: info.arch,
          os_distro: info.os_distro,
          os_release: info.os_release,
          os_arch: info.os_arch,
          gpu_vendor: info.gpu_vendor,
          gpu_model: info.gpu_model,
          gpu_vram_gb: info.gpu_vram_gb,
          gpu_count: info.gpus.length,
          gpu_driver_version: gpuDriverVersion,
          gpu_tier: info.gpu_tier,
          nvidia_driver_supported: info.nvidia_driver_supported,
          total_memory_gb: info.total_memory_gb,
          cpu_model: info.cpu_model,
          cpu_cores: info.cpu_cores,
          cpu_physical_cores: info.cpu_physical_cores,
          cpu_speed_ghz: info.cpu_speed_ghz,
          cpu_manufacturer: info.cpu_manufacturer,
          electron_version: info.electron_version,
          chrome_version: info.chrome_version,
          app_version: appVersion
        })
      } catch {}
    })
    .catch(() => {})
}

function reportRendererError(payload: {
  source: string
  message: string
  stack?: string
  context?: Record<string, unknown>
  skipPostHog?: boolean
}): void {
  if (!isTelemetryEmitAllowed('comfy.desktop.exception.error')) return
  const error = new Error(scrubAll(payload.message || 'Unknown error').slice(0, ERROR_MESSAGE_MAX))
  if (payload.stack) {
    error.stack = scrubAll(payload.stack).slice(0, ERROR_STACK_MAX)
  }
  const context = normalizeExceptionContext({
    origin: 'renderer',
    forwarded_source: payload.source,
    ...(payload.context || {})
  }) as TelemetryContext
  if (!payload.skipPostHog) {
    try {
      window.api.captureExceptionTelemetry({
        message: error.message,
        stack: error.stack,
        properties: context
      })
    } catch {}
    return
  }
  if (!claimRendererTelemetryBudget('comfy.desktop.exception.error')) return
  if (isDatadogInitialized) {
    try {
      error.name = 'DesktopTelemetryError'
      datadogRum.addError(error, {
        origin: context['origin'],
        source: context['source'],
        forwarded_source: context['forwarded_source'],
        level: context['level'],
        reason: context['reason'],
        exitCode: context['exitCode'],
        exit_code: context['exit_code'],
        type: context['type'],
        error_type: context['error_type']
      })
    } catch {}
  }
}

export function initializeRendererBootstrap(role: RendererRole = 'panel'): void {
  if (bootstrapInvoked) return
  bootstrapInvoked = true
  rendererRole = role

  window.api.onTelemetrySettingChanged((enabled) => {
    resolvedTelemetryEnabled = enabled
    if (isDatadogConfigured) setDatadogTrackingConsent(toDatadogTrackingConsent(enabled))
  })

  window.addEventListener(TELEMETRY_ACTION_EVENT_NAME, handleTelemetryActionBridgeEvent)

  window.api.onTelemetryActionFromMain((data) => {
    if (!data || typeof data.event !== 'string' || data.event.length === 0) return
    const ctx = (
      data.context && typeof data.context === 'object' ? data.context : {}
    ) as TelemetryContext
    trackTelemetryAction(data.event, ctx, { skipPostHog: data.mainAlreadyCaptured === true })
  })

  void initializeProviders()

  window.addEventListener('error', (event) => {
    const serialized = serializeUnknownError(event.error || event.message)
    reportRendererError({
      source: 'renderer-window-error',
      message: serialized.message,
      stack: serialized.stack,
      context: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      }
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    const serialized = serializeUnknownError(event.reason)
    reportRendererError({
      source: 'renderer-unhandled-rejection',
      message: serialized.message,
      stack: serialized.stack
    })
  })

  if (rendererRole === 'title-bar') {
    window.api.onDatadogError((data) => {
      reportRendererError({
        source: data.source || 'main-forwarded-error',
        message: data.message || 'Unknown forwarded error',
        stack: data.stack,
        context: {
          origin: 'main-process',
          level: data.level,
          ...(data.context || {})
        },
        skipPostHog: data.skipPostHog === true
      })
    })
  }

  if (rendererRole === 'panel') {
    window.api.onComfyBootLog((data) => {
      trackTelemetryAction('comfy.desktop.comfyui.boot_log', {
        installation_id: data.installationId,
        boot_stderr: data.bootStderr,
        session_kind: sessionKindOf(data.installationId)
      })
    })
  }
}
