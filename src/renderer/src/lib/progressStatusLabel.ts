import type { ComposerTranslation } from 'vue-i18n'

const OP_STATUS_MAP: Record<string, string> = {
  'Fetching latest stable version': 'Checking for latest version…',
  'Fetching version tags…': 'Checking for latest version…',
  'Already up to date': 'Already up to date',
  'Up to date': 'Already up to date',
  'Stopping…': 'Stopping instance…',
  'Creating Python environment…': 'Setting up environment…',
  'Loading snapshot…': 'Loading snapshot…',
  Complete: 'Finishing up…'
}

type TLike = ComposerTranslation | ((key: string, fallback?: string) => string)

interface Translator {
  t: (key: string) => string
  te: (key: string) => boolean
}

const STEP_NAME_KEY_PREFIX = 'installProgress.stepName.'
const MAIN_STATUS_KEY_PREFIX = 'launch.activity.'
const TRANSLATION_KEY = /^[a-z][\w-]*(?:\.[\w-]+)+$/i

export function progressStepName(
  step: { phase: string; label?: string },
  { t, te }: Translator
): string {
  const label = step.label?.trim() ?? ''
  if (label && label !== step.phase) return label
  const key = `${STEP_NAME_KEY_PREFIX}${step.phase}`
  return te(key) ? t(key) : label || step.phase
}

export function progressStatusText(raw: string | null | undefined, { t, te }: Translator): string {
  const status = raw?.trim() ?? ''
  if (!TRANSLATION_KEY.test(status)) return status
  if (te(status)) return t(status)
  return status.startsWith(MAIN_STATUS_KEY_PREFIX) ? '' : status
}

export function humanizeOpStatus(raw: string | null | undefined, t: TLike): string {
  const key = raw || ''
  if (key in OP_STATUS_MAP) return OP_STATUS_MAP[key]!
  if (key.startsWith('launch.activity.')) return (t as (k: string) => string)(key)
  if (key) return key
  return (t as (k: string, fb?: string) => string)('instancePicker.progressWorking', 'Working…')
}

export interface OperationLabelDescriptor {
  actionId: string
  actionData?: Record<string, unknown> | null
  title?: string
}

function isDowngrade(op: OperationLabelDescriptor): boolean {
  return (op.actionData as { isDowngrade?: boolean } | null | undefined)?.isDowngrade === true
}

export function operationInflightLabel(op: OperationLabelDescriptor, t: TLike): string {
  const tt = t as (k: string, fb?: string) => string
  switch (op.actionId) {
    case 'update-comfyui':
      return isDowngrade(op)
        ? tt('instancePicker.progressDowngrading', 'Downgrading…')
        : tt('instancePicker.progressUpdating', 'Updating…')
    case 'release-update':
      return tt('instancePicker.progressUpdating', 'Updating…')
    case 'copy':
      return tt('instancePicker.progressCopying', 'Copying…')
    case 'copy-update':
      return tt('instancePicker.progressCopyingUpdating', 'Copying & updating…')
    case 'copy-pytorch':
      return tt('instancePicker.progressCopyingChangingPytorch', 'Copying & changing PyTorch…')
    case 'delete':
      return tt('instancePicker.progressDeleting', 'Deleting…')
    case 'snapshot-restore':
      return tt('instancePicker.progressRestoring', 'Restoring snapshot…')
    case 'snapshot-save':
      return tt('instancePicker.progressSavingSnapshot', 'Saving snapshot…')
    case 'snapshot-delete':
      return tt('instancePicker.progressDeletingSnapshot', 'Deleting snapshot…')
    case 'migrate-to-standalone':
      return tt('instancePicker.progressMigrating', 'Migrating…')
    default:
      return op.title || tt('instancePicker.progressWorking', 'Working…')
  }
}

export function operationSuccessLabel(op: OperationLabelDescriptor, t: TLike): string {
  const tt = t as (k: string, fb?: string) => string
  switch (op.actionId) {
    case 'update-comfyui':
      return isDowngrade(op)
        ? tt('instancePicker.progressDowngraded', 'Downgrade complete')
        : tt('instancePicker.progressSuccessStopped', 'Update complete')
    case 'release-update':
      return tt('instancePicker.progressSuccessStopped', 'Update complete')
    case 'copy':
      return tt('instancePicker.progressCopied', 'Copy complete')
    case 'copy-update':
      return tt('instancePicker.progressCopiedUpdated', 'Copy complete')
    case 'copy-pytorch':
      return tt('instancePicker.progressCopiedPytorch', 'Copy complete')
    case 'delete':
      return tt('instancePicker.progressDeleted', 'Deleted')
    case 'snapshot-restore':
      return tt('instancePicker.progressRestored', 'Snapshot restored')
    case 'snapshot-save':
      return tt('instancePicker.progressSnapshotSaved', 'Snapshot saved')
    case 'snapshot-delete':
      return tt('instancePicker.progressSnapshotDeleted', 'Snapshot deleted')
    case 'migrate-to-standalone':
      return tt('instancePicker.progressMigrated', 'Migration complete')
    default:
      return tt('instancePicker.progressDone', 'Done')
  }
}
