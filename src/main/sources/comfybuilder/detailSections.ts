/**
 * Manage-view sections for a Builder build install.
 *
 * Deliberately NOT built on `standalone/updateSections.ts`. That model updates
 * along a ComfyUI release *channel*; a build pins its ComfyUI version, and
 * what the user moves between is build versions. Offering a channel
 * switch here would either do nothing or break the pin the build exists
 * to provide.
 *
 * Tabs a build deliberately does NOT get. A tab exists iff a section
 * declares it, so leaving one out IS the gate — don't reinstate either by
 * copying another source's sections wholesale:
 *
 *   - Snapshots — admin/owner only (Jul 24 dev-platform standup).
 *   - Storage - each build carries its own allowed model list, and
 *     shared models are off for builds at MVP. Note a REDUCED storage
 *     section does not achieve that: `StoragePane` treats an ABSENT
 *     `useSharedModels` field as enabled (`f ? f.value !== false : true`) and
 *     renders the global shared-models directory list, and declaring the field
 *     `false` is no better because `BooleanToggle` ignores `editable` and would
 *     hand the user a live switch. Showing a build's staged models needs
 *     its own pane, not a subset of this one.
 */
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

/** The build's own release. Stored in `version` because that IS what the
 *  builder versions; the ComfyUI build it pins is a separate fact. */
function buildVersion(installation: InstallationRecord): string {
  return (installation.version as string | undefined) || ''
}

/** The ComfyUI version the build pins, when the record carries one.
 *  Probed post-install like any other local install. */
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
    // Labelled as the build's version. A bare "7" next to a "v0.28.2"
    // reads as a ComfyUI version and isn't one.
    {
      key: 'build-version',
      label: t('comfybuilder.buildVersion'),
      value: build ? `v${build}` : '-'
    },
    { key: 'comfyui-version', label: t('comfybuilder.comfyuiVersion'), value: comfy || '—' },
    { label: t('common.location'), value: (installation.installPath as string) || '—' }
  ]
}

/**
 * The Update tab: which build version this install is on, and where it
 * can go.
 *
 * Versions come from the catalog cache, which the chooser's build read
 * warms. Cold (nothing read yet, or signed out) the latest row is omitted
 * rather than shown empty — "no versions found" is a different claim from "not
 * looked yet".
 */
function buildUpdateSection(installation: InstallationRecord): Record<string, unknown> | null {
  const buildId = installation.distributionId as string | undefined
  if (!buildId) return null

  const current = buildVersion(installation)
  const cached = getCachedVersions(buildId)
  const versions = cached?.versions ?? []
  const latest = versions[0]
  const availableUpdate = getAvailableUpdate(buildId, current)
  const updateAvailable = availableUpdate !== undefined

  // The same version table the local-install Update tab uses, so the two read
  // as one surface. Rows are stated as bare versions and left to compare
  // themselves — a "v9 available" sentence says the same thing while burying
  // the number it is about.
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
      // Only when there is somewhere to go. An always-present Update that no-ops
      // on the newest version teaches the user to distrust it.
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
                message: t('comfybuilder.updateConfirmMessage', {
                  from: `**v${current}**`,
                  to: `**v${availableUpdate}**`
                })
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
      // Args stay open even where a build may ignore some of them -
      // the Jul 24 standup kept the field editable rather than second-guessing
      // which flags a given build honours.
      fields: buildLaunchSettingsFields(installation, { defaultLaunchArgs: DEFAULT_LAUNCH_ARGS })
    },
    {
      // No title: only `.actions` is read off a pinBottom section (the footer
      // renders the buttons), so a title here would be an untranslated string
      // nothing displays.
      pinBottom: true,
      // Every id here is handled by the generic session-action dispatch
      // (`sessionActions/index.ts`), not by this plugin's `handleAction`.
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
