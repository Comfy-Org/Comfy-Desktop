/**
 * Manage-view sections for a distribution install.
 *
 * Deliberately NOT built on `standalone/updateSections.ts`. That model updates
 * along a ComfyUI release *channel*; a distribution pins its ComfyUI build, and
 * what the user moves between is distribution versions. Offering a channel
 * switch here would either do nothing or break the pin the distribution exists
 * to provide.
 *
 * Tabs a distribution deliberately does NOT get:
 *   - Snapshots — admin/owner only (Jul 24 dev-platform standup). Declaring a
 *     `snapshots` section is what makes the tab appear, so leaving it out IS
 *     the gate. Don't add one by copying another source wholesale.
 *   - Shared models — each distribution carries its own allowed model list, so
 *     `buildStorageFields`' shared-storage toggles don't apply in MVP.
 */
import { t } from '../../lib/i18n'
import { deleteAction, launchAction, openFolderAction, renameAction, untrackAction } from '../../lib/actions'
import { buildLaunchSettingsFields } from '../common/launchSettingsFields'
import { getCachedVersions } from '../../devplatform/versionCache'
import { formatComfyVersion } from '../../lib/version'
import type { ComfyVersion } from '../../lib/version'
import type { InstallationRecord } from '../../installations'
import { DEFAULT_LAUNCH_ARGS } from './constants'

/** The distribution's own release. Stored in `version` because that IS what the
 *  builder versions; the ComfyUI build it pins is a separate fact. */
function distributionVersion(installation: InstallationRecord): string {
  return (installation.version as string | undefined) || ''
}

/** The ComfyUI version the distribution pins, when the record carries one.
 *  Probed post-install like any other local install. */
function comfyVersionLabel(installation: InstallationRecord): string {
  const cv = installation.comfyVersion as ComfyVersion | undefined
  return cv ? formatComfyVersion(cv, 'detail') : ''
}

function buildStatusFields(installation: InstallationRecord): Record<string, unknown>[] {
  const dist = distributionVersion(installation)
  const comfy = comfyVersionLabel(installation)
  return [
    { label: t('common.installMethod'), value: (installation.sourceLabel as string) || 'ComfyBuilder' },
    {
      label: t('comfybuilder.distribution'),
      value: (installation.distributionName as string) || '—',
    },
    // Labelled as the DISTRIBUTION's version. A bare "7" next to a "v0.28.2"
    // reads as a ComfyUI version and isn't one.
    {
      key: 'distribution-version',
      label: t('comfybuilder.distributionVersion'),
      value: dist ? `v${dist}` : '—',
    },
    { key: 'comfyui-version', label: t('comfybuilder.comfyuiVersion'), value: comfy || '—' },
    { label: t('common.location'), value: (installation.installPath as string) || '—' },
  ]
}

/**
 * Storage for a distribution: where it lives and what it staged, read-only.
 *
 * No shared-model toggles — see the header. `StoragePane` resolves fields by id
 * and guards on absence, so a reduced set renders cleanly rather than erroring.
 */
function buildStorageFields(installation: InstallationRecord): Record<string, unknown>[] {
  return [
    {
      id: 'installPath',
      label: t('common.location'),
      value: (installation.installPath as string) || '',
      editable: false,
    },
    {
      id: 'distributionModels',
      label: t('comfybuilder.stagedModels'),
      value: t('comfybuilder.stagedModelsHint'),
      editable: false,
    },
  ]
}

/**
 * The Update tab: which distribution version this install is on, and what else
 * is published.
 *
 * Read-only for now. Switching versions is a re-install, and the install chain
 * that owns the status transitions (`installing` → `installed` / `failed`),
 * progress streaming and abort registration lives inline in the
 * `install-instance` IPC handler — it can't be driven from a source plugin.
 * Re-pointing the record here without it would strand the install at
 * `installing`, so the action waits on that plumbing rather than shipping a
 * button that half-works. Today the chooser tile's Update pill is the working
 * path to the latest version.
 *
 * The version list comes from the catalog cache, which the chooser's
 * distribution read warms. Cold (nothing read yet, or signed out) the list is
 * omitted rather than shown empty — "no versions found" is a different claim
 * from "not looked yet".
 */
function buildUpdateSection(installation: InstallationRecord): Record<string, unknown> | null {
  const distributionId = installation.distributionId as string | undefined
  if (!distributionId) return null

  const current = distributionVersion(installation)
  const versions = getCachedVersions(distributionId)?.versions ?? []
  const latest = versions[0]

  // Installed and latest are stated as bare versions and left to compare
  // themselves. A translated "up to date" / "v9 available" sentence would say
  // the same thing while hiding the number it is about.
  const fields: Record<string, unknown>[] = [
    {
      key: 'current-distribution-version',
      label: t('comfybuilder.installedVersion'),
      value: current ? `v${current}` : '—',
    },
  ]
  if (latest !== undefined) {
    fields.push({
      key: 'latest-distribution-version',
      label: t('comfybuilder.latestVersion'),
      value: `v${latest}`,
    })
  }
  if (versions.length > 1) {
    fields.push({
      key: 'published-distribution-versions',
      label: t('comfybuilder.publishedVersions'),
      value: versions.map((v) => `v${v}`).join(' · '),
    })
  }

  return {
    tab: 'update',
    title: t('comfybuilder.distributionVersionTitle'),
    fields,
    actions: [
      { id: 'check-update', label: t('actions.checkForUpdate'), style: 'default', enabled: true },
    ],
  }
}

export function getDetailSections(installation: InstallationRecord): Record<string, unknown>[] {
  const installed = installation.status === 'installed'

  const sections: Record<string, unknown>[] = [
    {
      tab: 'status',
      title: t('common.installInfo'),
      fields: buildStatusFields(installation),
    },
  ]

  const update = buildUpdateSection(installation)
  if (update) sections.push(update)

  sections.push(
    {
      tab: 'settings',
      title: t('common.launchSettings'),
      // Args stay open even where a distribution may ignore some of them —
      // the Jul 24 standup kept the field editable rather than second-guessing
      // which flags a given build honours.
      fields: buildLaunchSettingsFields(installation, { defaultLaunchArgs: DEFAULT_LAUNCH_ARGS }),
    },
    {
      tab: 'storage',
      fields: buildStorageFields(installation),
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
        openFolderAction(installation.installPath),
        untrackAction(),
        deleteAction(installation),
      ],
    },
  )

  return sections
}
