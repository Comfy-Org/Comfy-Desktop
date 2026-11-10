import {
  ipcMain,
  nativeTheme,
  sources,
  settings,
  i18n,
  getAppVersion,
  resolveTheme,
  _onLocaleChanged,
  _onThemeChanged,
  _broadcastToRenderer
} from './shared'
import { updateTitleBarOverlay } from '../titleBarOverlay'
import * as mainTelemetry from '../telemetry'
import { detectFirstUseState } from '../firstUseDetection'
import * as updater from '../updater'
import { globalSettingsEvents } from '../globalSettingsEvents'
import { acknowledgeBetaActivationNotice, peekBetaActivationNotice } from '../betaActivationNotice'
import { recordIpcInvocation } from '../e2eOverrides'
import type { SettingsSection } from '../../../types/ipc'
import { AUTO_LAUNCH_LAST, AUTO_LAUNCH_NONE } from '../../settings'

export function buildSettingsSections(
  installs?: Pick<{ id: string; name: string }, 'id' | 'name'>[]
): SettingsSection[] {
  const s = settings.getAll()
  const chineseMirrorsField = {
    id: 'useChineseMirrors',
    label: i18n.t('settings.useChineseMirrors'),
    type: 'boolean' as const,
    value: s.useChineseMirrors === true,
    tooltip: i18n.t('settings.chineseMirrorsDescription'),
    ...(s.useChineseMirrors === true
      ? { description: i18n.t('settings.chineseMirrorsDescription') }
      : {})
  }
  const isChinese = i18n.getLocale().startsWith('zh')
  const appSections: SettingsSection[] = [
    {
      title: i18n.t('settings.general'),
      fields: [
        {
          id: 'language',
          label: i18n.t('settings.language'),
          type: 'select',
          value: s.language || i18n.getLocale(),
          options: i18n.getAvailableLocales()
        },

        {
          id: 'autoLaunchOnStartup',
          label: i18n.t('settings.autoLaunchOnStartup'),
          type: 'select',
          value: (s.autoLaunchOnStartup as string | undefined) ?? AUTO_LAUNCH_NONE,
          options: [
            { value: AUTO_LAUNCH_NONE, label: i18n.t('settings.autoLaunchOnStartupNone') },
            { value: AUTO_LAUNCH_LAST, label: i18n.t('settings.autoLaunchOnStartupLast') },
            ...(installs ?? []).map((i) => ({ value: i.id, label: i.name }))
          ],
          tooltip: i18n.t('settings.autoLaunchOnStartupDescription')
        },

        {
          id: 'confirmBeforeClosingWindow',
          label: i18n.t('settings.confirmBeforeClosingWindow'),
          type: 'boolean',
          value: s.confirmBeforeClosingWindow === true,
          tooltip: i18n.t('settings.confirmBeforeClosingWindowDescription')
        },
        {
          id: 'warnBeforeRunningMultipleInstances',
          label: i18n.t('settings.warnBeforeRunningMultipleInstances'),
          type: 'boolean',
          value: s.warnBeforeRunningMultipleInstances !== false,
          tooltip: i18n.t('settings.warnBeforeRunningMultipleInstancesDescription')
        },

        {
          id: 'hideCloudFromPicker',
          label: i18n.t('settings.hideCloudFromPicker'),
          type: 'boolean',
          value: s.hideCloudFromPicker === true,
          tooltip: i18n.t('settings.hideCloudFromPickerDescription')
        },

        {
          id: 'autoInstallUpdates',
          label: i18n.t('settings.autoInstallUpdates'),
          type: 'boolean',
          value: s.autoInstallUpdates !== false
        },
        ...(isChinese ? [chineseMirrorsField] : [])
      ]
    },
    {
      title: i18n.t('settings.telemetry'),
      fields: [
        {
          id: 'telemetryEnabled',
          label: i18n.t('settings.telemetryEnabled'),
          type: 'boolean',
          value: s.telemetryEnabled !== false
        },
        {
          id: 'betaFeaturesEnabled',
          label: i18n.t('settings.betaFeaturesEnabled'),
          type: 'boolean',
          value: settings.resolveBetaFeaturesEnabled()
        }
      ]
    },
    {
      title: i18n.t('settings.cache'),
      fields: [
        {
          id: 'cacheDir',
          label: i18n.t('settings.cacheDir'),
          type: 'path',
          value: s.cacheDir,
          openable: true
        }
      ]
    },
    {
      title: i18n.t('settings.advanced'),
      fields: [
        {
          id: 'pypiMirror',
          label: i18n.t('settings.pypiMirror'),
          type: 'text' as const,
          value: s.pypiMirror || '',
          placeholder: i18n.t('settings.pypiMirrorPlaceholder')
        },
        ...(!isChinese ? [chineseMirrorsField] : []),
        {
          id: 'hardwareAcceleration',
          label: i18n.t('settings.hardwareAcceleration'),
          type: 'boolean',
          value: s.hardwareAcceleration !== false,
          description: i18n.t('settings.hardwareAccelerationDescription'),
          tooltip: i18n.t('settings.hardwareAccelerationDescription')
        }
      ]
    }
  ]
  const sourceSections = sources.flatMap((src) => {
    const plugin = src as unknown as Record<string, unknown>
    if (typeof plugin.getSettingsSections === 'function') {
      return (plugin.getSettingsSections as (s: Record<string, unknown>) => SettingsSection[])(
        s as Record<string, unknown>
      )
    }
    return []
  })
  const version = getAppVersion()
  const aboutSection: SettingsSection = {
    title: i18n.t('settings.about'),
    fields: [
      {
        id: 'about-version',
        label: i18n.t('settings.version'),
        type: 'text',
        value: version,
        readonly: true
      },
      {
        id: 'about-platform',
        label: i18n.t('settings.platform'),
        type: 'text',
        value: `${process.platform} (${process.arch})`,
        readonly: true
      }
    ],
    actions: [{ label: 'GitHub', url: 'https://github.com/Comfy-Org/Comfy-Desktop' }]
  }
  return [...appSections, ...sourceSections, aboutSection]
}

export function buildModelsPayload(): { systemDefault: string; sections: SettingsSection[] } {
  const s = settings.getAll()
  return {
    systemDefault: settings.defaults.modelsDirs[0] ?? '',
    sections: [
      {
        title: i18n.t('models.directories'),
        fields: [
          {
            id: 'modelsDirs',
            label: i18n.t('models.directoriesDesc'),
            type: 'pathList',
            value: s.modelsDirs || []
          }
        ]
      }
    ]
  }
}

export function buildInstallLocationFields(): SettingsSection[] {
  const s = settings.getAll()
  return [
    {
      fields: [
        {
          id: 'installDir',
          label: '',
          type: 'path' as const,
          value: s.installDir || settings.defaults.installDir,
          openable: true
        }
      ]
    }
  ]
}

export function buildMediaSections(): SettingsSection[] {
  const s = settings.getAll()
  return [
    {
      title: i18n.t('media.sharedDirs'),
      fields: [
        {
          id: 'inputDir',
          label: i18n.t('media.inputDir'),
          type: 'path' as const,
          value: s.inputDir || settings.defaults.inputDir,
          openable: true,
          tooltip: i18n.t('tooltips.inputDir')
        },
        {
          id: 'outputDir',
          label: i18n.t('media.outputDir'),
          type: 'path' as const,
          value: s.outputDir || settings.defaults.outputDir,
          openable: true,
          tooltip: i18n.t('tooltips.outputDir')
        }
      ]
    }
  ]
}

export function applySettingSet(key: string, value: unknown): void {
  if (
    key === 'betaFeaturesEnabled' &&
    value === true &&
    settings.get('betaFeaturesEnabled') !== true &&
    settings.get('telemetryEnabled') !== true
  ) {
    return
  }
  settings.set(key, value)
  if (key === 'theme') {
    _broadcastToRenderer('theme-changed', resolveTheme())
    updateTitleBarOverlay()
    if (_onThemeChanged) _onThemeChanged()
  }
  if (key === 'language') {
    i18n.init(value as string)
    _broadcastToRenderer('locale-changed', {
      locale: i18n.getLocale(),
      messages: i18n.getMessages()
    })
    if (_onLocaleChanged) _onLocaleChanged()
  }
  if (key === 'telemetryEnabled') {
    _broadcastToRenderer('telemetry-setting-changed', value)
    const state: mainTelemetry.ConsentState =
      value === true ? 'granted' : value === false ? 'denied' : 'undecided'
    mainTelemetry.setConsentState(state)
  }
  if (key === 'autoInstallUpdates' || key === 'autoUpdate') {
    updater.notifyAutoUpdateChanged()
  }
  const trackedProps = settings.getTrackedSettingsTelemetryProperties([key])
  if (Object.keys(trackedProps).length > 0) {
    mainTelemetry.registerPersonProperties(trackedProps)
  }
  _broadcastToRenderer('settings-changed', { key })
  globalSettingsEvents.emit('changed')
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('get-settings-sections', () => buildSettingsSections())
  ipcMain.handle('get-models-sections', () => buildModelsPayload())
  ipcMain.handle('get-media-sections', () => buildMediaSections())

  ipcMain.handle('set-setting', (_event, key: string, value: unknown) => {
    recordIpcInvocation('set-setting', { key, value })
    applySettingSet(key, value)
  })

  ipcMain.handle('get-setting', (_event, key: string) => {
    return settings.get(key)
  })

  ipcMain.handle('get-pending-beta-notice', (_event, installationId: unknown) => {
    if (typeof installationId !== 'string' || installationId === '') return null
    return peekBetaActivationNotice(installationId)
  })

  ipcMain.handle(
    'acknowledge-beta-notice',
    (_event, installationId: unknown, shownArgs?: unknown) => {
      if (typeof installationId !== 'string' || installationId === '') return
      recordIpcInvocation('acknowledge-beta-notice', { installationId })
      const isStringArray = (v: unknown): v is string[] =>
        Array.isArray(v) && v.length > 0 && v.every((a) => typeof a === 'string')
      if (shownArgs !== undefined && !isStringArray(shownArgs)) return
      acknowledgeBetaActivationNotice(installationId, shownArgs)
    }
  )

  ipcMain.handle('get-locale-messages', () => i18n.getMessages())
  ipcMain.handle('get-available-locales', () => i18n.getAvailableLocales())
  ipcMain.handle('get-locale', () => i18n.getLocale())

  ipcMain.handle('get-first-use-state', () => detectFirstUseState())

  ipcMain.handle('get-resolved-theme', () => resolveTheme())

  nativeTheme.on('updated', () => {
    if (((settings.get('theme') as string | undefined) || 'system') !== 'system') return
    _broadcastToRenderer('theme-changed', resolveTheme())
    updateTitleBarOverlay()
    if (_onThemeChanged) _onThemeChanged()
  })
}
