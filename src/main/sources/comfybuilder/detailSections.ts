import { t } from '../../lib/i18n'
import {
  copyAction,
  deleteAction,
  launchAction,
  openFolderAction,
  renameAction,
  untrackAction
} from '../../lib/actions'
import { buildLaunchSettingsFields } from '../common/launchSettingsFields'
import { getAvailableUpdate, getCachedVersions } from '../../devplatform/versionCache'
import { formatComfyVersion } from '../../lib/version'
import type { ComfyVersion } from '../../lib/version'
import type { InstallationRecord } from '../../installations'
import { DEFAULT_LAUNCH_ARGS } from './constants'

function buildVersion(installation: InstallationRecord): string {
  return (installation.version as string | undefined) || ''
}

function comfyVersionLabel(installation: InstallationRecord): string {
  const cv = installation.comfyVersion as ComfyVersion | undefined
  return cv ? formatComfyVersion(cv, 'detail') : ''
}

function buildStatusFields(installation: InstallationRecord): Record<string, unknown>[] {
  const build = buildVersion(installation)
  const comfy = comfyVersionLabel(installation)
  return [
    {
      label: t('common.installMethod'),
      value: (installation.sourceLabel as string) || 'ComfyBuilder'
    },
    {
      label: t('comfybuilder.build'),
      value: (installation.distributionName as string) || '—'
    },
    {
      key: 'build-version',
      label: t('comfybuilder.buildVersion'),
      value: build ? `v${build}` : '-'
    },
    { key: 'comfyui-version', label: t('comfybuilder.comfyuiVersion'), value: comfy || '—' },
    { label: t('common.location'), value: (installation.installPath as string) || '—' }
  ]
}

function buildUpdateSection(installation: InstallationRecord): Record<string, unknown> | null {
  const buildId = installation.distributionId as string | undefined
  if (!buildId) return null

  const current = buildVersion(installation)
  const cached = getCachedVersions(buildId)
  const versions = cached?.versions ?? []
  const latest = versions[0]
  const availableUpdate = getAvailableUpdate(buildId, current)
  const updateAvailable = availableUpdate !== undefined

  const rows: Record<string, unknown>[] = [
    {
      id: 'installed',
      label: t('comfybuilder.installedVersion'),
      value: current ? `v${current}` : '—'
    }
  ]
  if (latest !== undefined) {
    rows.push({
      id: 'latest',
      label: t('comfybuilder.latestVersion'),
      value: `v${latest}`,
      highlight: updateAvailable
    })
  }
  if (cached?.fetchedAt) {
    rows.push({
      id: 'last-checked',
      label: t('comfybuilder.lastChecked'),
      value: new Date(cached.fetchedAt).toLocaleString()
    })
  }

  return {
    tab: 'update',
    title: t('comfybuilder.buildVersionTitle'),
    fields: [
      {
        id: 'buildVersionStats',
        label: t('comfybuilder.buildVersionTitle'),
        editType: 'version-stats',
        editable: false,
        value: {
          headline: current ? `v${current}` : '—',
          headlineHighlight: updateAvailable,
          badge: updateAvailable
            ? t('comfybuilder.updateAvailable')
            : latest !== undefined
              ? t('comfybuilder.upToDate')
              : null,
          badgeTone: updateAvailable ? 'update' : 'current',
          rows
        }
      }
    ],
    actions: [
      { id: 'check-update', label: t('actions.checkForUpdate'), style: 'default', enabled: true },
      ...(updateAvailable
        ? [
            {
              id: 'update-comfyui',
              label: t('comfybuilder.updateToVersion', { version: availableUpdate }),
              style: 'primary',
              enabled: installation.status === 'installed',
              showProgress: true,
              cancellable: true,
              progressTitle: t('comfybuilder.updatingTo', { version: availableUpdate }),
              data: { version: availableUpdate },
              confirm: {
                title: t('comfybuilder.updateConfirmTitle'),
                message: `${t('comfybuilder.updateConfirmMessage', {
                  from: `**v${current}**`,
                  to: `**v${availableUpdate}**`
                })}\n\n${t('comfybuilder.updateConfirmInfo')}`,
                confirmLabel: t('comfybuilder.updateNow')
              }
            }
          ]
        : [])
    ]
  }
}

export function getDetailSections(installation: InstallationRecord): Record<string, unknown>[] {
  const installed = installation.status === 'installed'

  const sections: Record<string, unknown>[] = [
    {
      tab: 'status',
      title: t('common.installInfo'),
      fields: buildStatusFields(installation)
    }
  ]

  const update = buildUpdateSection(installation)
  if (update) sections.push(update)

  sections.push(
    {
      tab: 'settings',
      title: t('common.launchSettings'),
      fields: buildLaunchSettingsFields(installation, { defaultLaunchArgs: DEFAULT_LAUNCH_ARGS })
    },
    {
      pinBottom: true,
      actions: [
        launchAction(installed, !installed ? t('errors.installNotReady') : undefined),
        renameAction(installation.name),
        copyAction(installation.name, installed),
        openFolderAction(installation.installPath),
        untrackAction(),
        deleteAction(installation)
      ]
    }
  )

  return sections
}
