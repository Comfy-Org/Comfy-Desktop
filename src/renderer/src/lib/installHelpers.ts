import { ref, onUnmounted } from 'vue'
import type { DiskSpaceInfo, FieldOption, PathIssue } from '../types/ipc'
import { emitTelemetryAction } from './telemetry'
import { formatBytes } from './formatting'

const pathIssueI18nKeys: Record<PathIssue, { title: string; message: string }> = {
  insideAppBundle: {
    title: 'pathValidation.insideAppBundleTitle',
    message: 'pathValidation.insideAppBundleMessage'
  },
  oneDrive: {
    title: 'pathValidation.oneDriveTitle',
    message: 'pathValidation.oneDriveMessage'
  },
  insideSharedDir: {
    title: 'pathValidation.insideSharedDirTitle',
    message: 'pathValidation.insideSharedDirMessage'
  },
  insideExistingInstall: {
    title: 'pathValidation.insideExistingInstallTitle',
    message: 'pathValidation.insideExistingInstallMessage'
  }
}

export function toPathGuardrail(issue: PathIssue): string {
  switch (issue) {
    case 'insideAppBundle':
      return 'path_inside_bundle'
    case 'oneDrive':
      return 'onedrive'
    case 'insideSharedDir':
      return 'inside_shared_dir'
    case 'insideExistingInstall':
      return 'inside_existing_install'
    default:
      return 'path_issue'
  }
}

export function trackGuardrailBlocked(guardrailType: string, flow: string, stage: string): void {
  emitTelemetryAction('comfy.desktop.install.guardrail.blocked', {
    guardrail_type: guardrailType,
    flow,
    stage
  })
}

export async function showPathIssueAlerts(
  issues: PathIssue[],
  flow: string,
  stage: string,
  alert: (opts: { title: string; message: string }) => Promise<void>,
  t: (key: string) => string
): Promise<boolean> {
  for (const issue of issues) {
    const keys = pathIssueI18nKeys[issue]
    if (keys) {
      trackGuardrailBlocked(toPathGuardrail(issue), flow, stage)
      await alert({ title: t(keys.title), message: t(keys.message) })
      return false
    }
  }
  return true
}

export async function checkNvidiaDriverOrWarn(
  flow: string,
  stage: string,
  confirm: (opts: {
    title: string
    message: string
    confirmLabel: string
    confirmStyle: string
  }) => Promise<boolean>,
  t: (key: string, params?: Record<string, string>) => string
): Promise<boolean> {
  const driverCheck = await window.api.checkNvidiaDriver()
  if (driverCheck && !driverCheck.supported) {
    const ok = await confirm({
      title: t('newInstall.nvidiaDriverWarningTitle'),
      message: t('newInstall.nvidiaDriverWarning', {
        driverVersion: driverCheck.driverVersion,
        minimumVersion: driverCheck.minimumVersion
      }),
      confirmLabel: t('newInstall.nvidiaDriverContinue'),
      confirmStyle: 'primary'
    })
    if (!ok) {
      trackGuardrailBlocked('nvidia_driver', flow, stage)
      return false
    }
  }
  return true
}

export function trackDiskWarningResponse(
  warningType: string,
  accepted: boolean,
  flow: string
): void {
  emitTelemetryAction('comfy.desktop.install.disk_warning.response', {
    warning_type: warningType,
    accepted,
    flow
  })
}

export async function checkDiskSpaceOrWarn(opts: {
  path: string
  estimatedRequired: number
  flow: string
  confirm: (opts: {
    title: string
    message: string
    confirmLabel: string
    confirmStyle: string
  }) => Promise<boolean>
  t: (key: string, params?: Record<string, string>) => string
}): Promise<boolean> {
  const space = await window.api.getDiskSpace(opts.path)

  if (opts.estimatedRequired > 0 && space.free < opts.estimatedRequired) {
    const ok = await opts.confirm({
      title: opts.t('diskSpace.warningTitle'),
      message: opts.t('diskSpace.warningMessage', {
        free: formatBytes(space.free),
        required: formatBytes(opts.estimatedRequired)
      }),
      confirmLabel: opts.t('diskSpace.continueAnyway'),
      confirmStyle: 'primary'
    })
    trackDiskWarningResponse('insufficient_estimated', !!ok, opts.flow)
    if (!ok) return false
  } else if (space.free < 1073741824) {
    const ok = await opts.confirm({
      title: opts.t('diskSpace.warningTitle'),
      message: opts.t('diskSpace.warningMessageGeneric', {
        free: formatBytes(space.free)
      }),
      confirmLabel: opts.t('diskSpace.continueAnyway'),
      confirmStyle: 'primary'
    })
    trackDiskWarningResponse('low_free_space', !!ok, opts.flow)
    if (!ok) return false
  }

  return true
}

const TEMPLATE_DISK_HEADROOM = 1.1

export function templateDiskRequiredBytes(estimatedModelBytes: number): number {
  if (estimatedModelBytes <= 0) return 0
  return Math.ceil(estimatedModelBytes * TEMPLATE_DISK_HEADROOM)
}

export function isTemplateDiskBlocked(
  diskSpace: DiskSpaceInfo | null,
  estimatedModelBytes: number
): boolean {
  const required = templateDiskRequiredBytes(estimatedModelBytes)
  if (required === 0 || !diskSpace) return false
  return diskSpace.free < required
}

export function minTemplateModelBytes(modelByteSizes: number[]): number {
  const withModels = modelByteSizes.filter((b) => b > 0)
  return withModels.length ? Math.min(...withModels) : 0
}

export function templateSizeBytes(option: FieldOption | null | undefined): number {
  const size = option?.data?.sizeBytes
  return typeof size === 'number' && size > 0 ? size : 0
}

export function templateDownloadBytes(option: FieldOption | null | undefined): number {
  return option?.data?.modelsPresent === true ? 0 : templateSizeBytes(option)
}

export function isApiNodeTemplate(option: FieldOption | null | undefined): boolean {
  return option?.data?.apiNode === true
}

export async function checkTemplateDiskOrBlock(opts: {
  path: string
  estimatedModelBytes: number
  flow: string
  alert: (opts: { title: string; message: string }) => Promise<void>
  t: (key: string, params?: Record<string, string>) => string
}): Promise<boolean> {
  if (templateDiskRequiredBytes(opts.estimatedModelBytes) === 0) return true

  let diskSpace: DiskSpaceInfo
  try {
    diskSpace = await window.api.getDiskSpace(opts.path)
  } catch {
    return true
  }
  if (!isTemplateDiskBlocked(diskSpace, opts.estimatedModelBytes)) return true

  trackGuardrailBlocked('template_models_disk', opts.flow, 'save')
  await opts.alert({
    title: opts.t('diskSpace.templateBlockTitle'),
    message: opts.t('diskSpace.templateBlockMessage', {
      required: formatBytes(templateDiskRequiredBytes(opts.estimatedModelBytes)),
      free: formatBytes(diskSpace.free)
    })
  })
  return false
}

export function createDiskSpaceChecker() {
  const diskSpace = ref<DiskSpaceInfo | null>(null)
  const diskSpaceLoading = ref(false)
  const pathIssues = ref<PathIssue[]>([])
  let diskSpaceTimer: ReturnType<typeof setTimeout> | null = null
  let diskSpaceGeneration = 0

  function fetchDiskSpace(targetPath: string): void {
    if (diskSpaceTimer) clearTimeout(diskSpaceTimer)
    diskSpaceTimer = setTimeout(async () => {
      if (!targetPath) {
        diskSpace.value = null
        pathIssues.value = []
        return
      }
      const gen = ++diskSpaceGeneration
      diskSpaceLoading.value = true
      try {
        const [space, issues] = await Promise.all([
          window.api.getDiskSpace(targetPath),
          window.api.validateInstallPath(targetPath)
        ])
        if (gen !== diskSpaceGeneration) return
        diskSpace.value = space
        pathIssues.value = issues
      } catch {
        if (gen !== diskSpaceGeneration) return
        diskSpace.value = null
        pathIssues.value = []
      } finally {
        if (gen === diskSpaceGeneration) {
          diskSpaceLoading.value = false
        }
      }
    }, 300)
  }

  function reset(): void {
    diskSpace.value = null
    diskSpaceLoading.value = false
    pathIssues.value = []
    if (diskSpaceTimer) clearTimeout(diskSpaceTimer)
    diskSpaceGeneration++
  }

  onUnmounted(() => {
    if (diskSpaceTimer) clearTimeout(diskSpaceTimer)
  })

  return {
    diskSpace,
    diskSpaceLoading,
    pathIssues,
    fetchDiskSpace,
    reset
  }
}
