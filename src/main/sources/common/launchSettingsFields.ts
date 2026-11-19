import fs from 'fs'
import path from 'path'
import { t } from '../../lib/i18n'
import {
  installModelsDir,
  installInputDir,
  installOutputDir,
  resolveComfyDir,
  resolveExtraModelPaths
} from '../../lib/models'
import type { InstallationRecord } from '../../installations'
import {
  DEFAULT_MANAGER_SECURITY_LEVEL,
  MANAGER_SECURITY_LEVELS,
  isManagerSecurityLevel,
  DEFAULT_MANAGER_NETWORK_MODE,
  MANAGER_NETWORK_MODES,
  isManagerNetworkMode
} from '../../lib/managerConfig'

export interface ExtraModelPathDir {
  type: string
  rawType: string
  dir: string
  dirExists: boolean
}

export interface ExtraModelPathSection {
  name: string
  basePath: string | null
  basePathExists: boolean
  isDefault: boolean
  dirs: ExtraModelPathDir[]
}

export interface ExtraModelPathsView {
  yamlPath: string
  exists: boolean
  sections: ExtraModelPathSection[]
}

export function buildExtraModelPathsView(installation: InstallationRecord): ExtraModelPathsView {
  const installPath = installation.installPath as string | undefined
  if (!installPath) return { yamlPath: '', exists: false, sections: [] }
  const yamlPath = path.join(resolveComfyDir(installPath), 'extra_model_paths.yaml')

  const sections: ExtraModelPathSection[] = []
  const byName = new Map<string, ExtraModelPathSection>()
  for (const r of resolveExtraModelPaths(yamlPath)) {
    let section = byName.get(r.section)
    if (!section) {
      section = {
        name: r.section,
        basePath: r.basePath,
        basePathExists: r.basePath != null && fs.existsSync(r.basePath),
        isDefault: r.isDefault,
        dirs: []
      }
      byName.set(r.section, section)
      sections.push(section)
    }
    section.dirs.push({
      type: r.type,
      rawType: r.rawType,
      dir: r.dir,
      dirExists: fs.existsSync(r.dir)
    })
  }

  return { yamlPath, exists: fs.existsSync(yamlPath), sections }
}

export interface LaunchSettingsOptions {
  defaultLaunchArgs: string
  defaultLaunchMode?: string
  defaultBrowserPartition?: string
  defaultPortConflict?: string
  extraFields?: Record<string, unknown>[]
}

export function buildStorageFields(installation: InstallationRecord): Record<string, unknown>[] {
  const useSharedModels = (installation.useSharedModels as boolean | undefined) !== false
  const useSharedInput = (installation.useSharedInput as boolean | undefined) !== false
  const useSharedOutput = (installation.useSharedOutput as boolean | undefined) !== false
  const installPath = installation.installPath as string | undefined
  const ownModelsDir = installPath ? installModelsDir(installPath) : ''
  const ownInputDir = installPath ? installInputDir(installPath) : ''
  const ownOutputDir = installPath ? installOutputDir(installPath) : ''
  return [
    {
      id: 'useSharedModels',
      label: t('common.useSharedModels'),
      value: useSharedModels,
      editable: true,
      editType: 'boolean',
      tooltip: t('tooltips.useSharedModels'),
      requiresRestart: true
    },
    {
      id: 'useSharedInput',
      label: t('common.useSharedInput'),
      value: useSharedInput,
      editable: true,
      editType: 'boolean',
      tooltip: t('tooltips.useSharedInput'),
      requiresRestart: true
    },
    {
      id: 'useSharedOutput',
      label: t('common.useSharedOutput'),
      value: useSharedOutput,
      editable: true,
      editType: 'boolean',
      tooltip: t('tooltips.useSharedOutput'),
      requiresRestart: true
    },
    {
      id: 'modelDirs',
      label: t('common.perInstallModelDirs'),
      value: (installation.modelDirs as string[] | undefined) ?? [],
      editable: true,
      editType: 'model-dirs',
      tooltip: t('tooltips.perInstallModelDirs'),
      requiresRestart: true
    },
    {
      id: 'modelDirsPrimary',
      label: 'modelDirsPrimary',
      value: (installation.modelDirsPrimary as string | undefined) ?? null,
      editable: true,
      editType: 'hidden',
      requiresRestart: true
    },
    {
      id: 'installModelsDir',
      label: t('common.perInstallModelDirs'),
      value: ownModelsDir,
      editable: false,
      editType: 'hidden'
    },
    {
      id: 'inputDir',
      label: t('common.perInstallInputDir'),
      value: (installation.inputDir as string | undefined) ?? '',
      editable: true,
      editType: 'path',
      browseOnly: true,
      tooltip: t('tooltips.perInstallInputDir'),
      requiresRestart: true
    },
    {
      id: 'outputDir',
      label: t('common.perInstallOutputDir'),
      value: (installation.outputDir as string | undefined) ?? '',
      editable: true,
      editType: 'path',
      browseOnly: true,
      tooltip: t('tooltips.perInstallOutputDir'),
      requiresRestart: true
    },
    {
      id: 'inputDirDefault',
      label: t('common.perInstallInputDir'),
      value: ownInputDir,
      editable: false,
      editType: 'hidden'
    },
    {
      id: 'outputDirDefault',
      label: t('common.perInstallOutputDir'),
      value: ownOutputDir,
      editable: false,
      editType: 'hidden'
    },
    {
      id: 'extraModelPaths',
      label: 'extraModelPaths',
      value: buildExtraModelPathsView(installation),
      editable: false,
      editType: 'hidden'
    }
  ]
}

export function buildLaunchSettingsFields(
  installation: InstallationRecord,
  options: LaunchSettingsOptions
): Record<string, unknown>[] {
  const {
    defaultLaunchArgs,
    defaultLaunchMode = 'window',
    defaultBrowserPartition = 'shared',
    defaultPortConflict = 'ask',
    extraFields = []
  } = options

  const fields: Record<string, unknown>[] = []

  fields.push(
    ...extraFields,
    {
      id: 'launchArgs',
      label: t('common.startupArgs'),
      value: (installation.launchArgs as string | undefined) ?? defaultLaunchArgs,
      editable: true,
      editType: 'args-builder',
      tooltip: t('tooltips.startupArgs'),
      requiresRestart: true
    },
    {
      id: 'managerSecurityLevel',
      label: t('common.managerSecurityLevel'),
      value: isManagerSecurityLevel(installation.managerSecurityLevel)
        ? installation.managerSecurityLevel
        : DEFAULT_MANAGER_SECURITY_LEVEL,
      editable: true,
      editType: 'select',
      options: MANAGER_SECURITY_LEVELS.map((level) => ({
        value: level,
        label: t(`common.managerSecurityLevel_${level}`),
        description: t(`common.managerSecurityLevel_${level}_desc`)
      })),
      tooltip: t('tooltips.managerSecurityLevel'),
      requiresRestart: true,
      rowGroup: 'manager'
    },
    {
      id: 'managerNetworkMode',
      label: t('common.managerNetworkMode'),
      value: isManagerNetworkMode(installation.managerNetworkMode)
        ? installation.managerNetworkMode
        : DEFAULT_MANAGER_NETWORK_MODE,
      editable: true,
      editType: 'select',
      options: MANAGER_NETWORK_MODES.map((mode) => ({
        value: mode,
        label: t(`common.managerNetworkMode_${mode}`),
        description: t(`common.managerNetworkMode_${mode}_desc`)
      })),
      tooltip: t('tooltips.managerNetworkMode'),
      requiresRestart: true,
      rowGroup: 'manager'
    },
    {
      id: 'launchMode',
      label: t('common.launchMode'),
      value: (installation.launchMode as string | undefined) || defaultLaunchMode,
      editable: true,
      editType: 'select',
      options: [
        { value: 'window', label: t('common.launchModeWindow') },
        { value: 'console', label: t('common.launchModeConsole') }
      ],
      tooltip: t('tooltips.launchMode'),
      requiresRestart: true,
      rowGroup: 'launch-window'
    },
    {
      id: 'browserPartition',
      label: t('common.browserPartition'),
      value: (installation.browserPartition as string | undefined) || defaultBrowserPartition,
      editable: true,
      editType: 'select',
      options: [
        { value: 'shared', label: t('common.partitionShared') },
        { value: 'unique', label: t('common.partitionUnique') }
      ],
      tooltip: t('tooltips.browserPartition'),
      requiresRestart: true,
      rowGroup: 'launch-window'
    },
    {
      id: 'portConflict',
      label: t('common.portConflict'),
      value: (installation.portConflict as string | undefined) || defaultPortConflict,
      editable: true,
      editType: 'select',
      options: [
        { value: 'ask', label: t('common.portConflictAsk') },
        { value: 'auto', label: t('common.portConflictAuto') }
      ],
      requiresRestart: true
    },
    {
      id: 'envVars',
      label: t('common.envVars'),
      value: (installation.envVars as Record<string, string> | undefined) ?? {},
      editable: true,
      editType: 'env-vars',
      tooltip: t('tooltips.envVars'),
      requiresRestart: true
    }
  )

  return fields
}
