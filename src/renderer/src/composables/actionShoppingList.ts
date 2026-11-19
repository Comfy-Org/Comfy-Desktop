import type { useModal } from './useModal'
import type { useDialogs } from './useDialogs'
import type { ActionDef, DiskSpaceInfo, FieldOption, Installation } from '../types/ipc'

type Modal = ReturnType<typeof useModal>
type Dialogs = ReturnType<typeof useDialogs>
type Translate = (key: string, payload?: Record<string, unknown>) => string

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export async function runFieldSelectsChain(
  action: ActionDef,
  driver: Modal | Dialogs,
  t: Translate
): Promise<ActionDef | null> {
  if (!action.fieldSelects) return action
  const showAlert = pickAlert(driver)
  const showPick = pickPicker(driver)
  let next = action
  const selections: Record<string, FieldOption> = {}
  for (const fs of action.fieldSelects) {
    let items: FieldOption[]
    try {
      items = await window.api.getFieldOptions(fs.sourceId, fs.fieldId, selections)
    } catch (err: unknown) {
      await showAlert({ title: next.label, message: (err as Error).message || String(err) })
      return null
    }
    if (!items || items.length === 0) {
      await showAlert({
        title: next.label,
        message: fs.emptyMessage || t('common.noItems')
      })
      return null
    }
    const selectItems = items.map((item) => ({
      value: item.value,
      label: (item.recommended ? '★ ' : '') + item.label,
      description: item.description
    }))
    const selected = await showPick({
      title: fs.title || next.label,
      message: fs.message || '',
      items: selectItems
    })
    if (!selected) return null
    const selectedItem = items.find((i) => i.value === selected)
    if (selectedItem) selections[fs.fieldId] = selectedItem
    next = { ...next, data: { ...next.data, [fs.field]: selectedItem } }
  }
  return next
}

function isDialogs(driver: Modal | Dialogs): driver is Dialogs {
  return typeof (driver as Dialogs).actionSheet === 'function'
}
function pickAlert(driver: Modal | Dialogs) {
  return (opts: { title: string; message: string }): Promise<unknown> => driver.alert(opts)
}
function pickPicker(driver: Modal | Dialogs) {
  return (opts: {
    title: string
    message: string
    items: { value: string; label: string; description?: string }[]
  }): Promise<string | null> => (isDialogs(driver) ? driver.actionSheet(opts) : driver.select(opts))
}
function pickPrompt(driver: Modal | Dialogs) {
  return (opts: Parameters<Modal['prompt']>[0]): Promise<string | null> => driver.prompt(opts)
}

export async function runSelectChain(
  action: ActionDef,
  ownerInstallationId: string,
  driver: Modal | Dialogs,
  t: Translate
): Promise<ActionDef | null> {
  if (!action.select) return action
  const showAlert = pickAlert(driver)
  const showPick = pickPicker(driver)
  let items: { value: string; label: string; description?: string }[] | undefined
  if (action.select.source === 'installations') {
    let all = await window.api.getInstallations()
    if (action.select.excludeSelf) {
      all = all.filter((i) => i.id !== ownerInstallationId)
    }
    if (action.select.filters) {
      for (const [key, value] of Object.entries(action.select.filters)) {
        all = all.filter((i) => (i as Record<string, unknown>)[key] === value)
      }
    }
    items = all.map((i) => ({ value: i.id, label: i.name, description: i.sourceLabel }))
  }
  if (!items || items.length === 0) {
    await showAlert({
      title: action.label,
      message: action.select.emptyMessage || t('common.noItems')
    })
    return null
  }
  const selected = await showPick({
    title: action.select.title || action.label,
    message: action.select.message || '',
    items
  })
  if (!selected) return null
  return { ...action, data: { ...action.data, [action.select.field]: selected } }
}

export async function runPromptChain(
  action: ActionDef,
  driver: Modal | Dialogs
): Promise<ActionDef | null> {
  if (!action.prompt) return action
  const showPrompt = pickPrompt(driver)
  let defaultValue = action.prompt.defaultValue
  if (action.prompt.uniquifyDefault && defaultValue) {
    try {
      defaultValue = await window.api.getUniqueName(defaultValue)
    } catch {}
  }
  const value = await showPrompt({
    title: action.prompt.title || action.label,
    message: action.prompt.message || '',
    placeholder: action.prompt.placeholder,
    defaultValue,
    confirmLabel: action.prompt.confirmLabel || action.label,
    required: action.prompt.required,
    messageDetails: action.prompt.messageDetails
  })
  if (!value) return null
  return { ...action, data: { ...action.data, [action.prompt.field]: value } }
}

export async function runConfirmChain(
  action: ActionDef,
  modal: Modal,
  dialogs?: Dialogs
): Promise<ActionDef | null> {
  if (!action.confirm) return action
  if (action.confirm.options) {
    const result = await modal.confirmWithOptions({
      title: action.confirm.title || 'Confirm',
      message: action.confirm.message || 'Are you sure?',
      options: action.confirm.options,
      confirmLabel: action.confirm.confirmLabel || action.label,
      confirmStyle: action.style || 'danger'
    })
    if (!result) return null
    return { ...action, data: { ...action.data, ...result } }
  }
  if (dialogs) {
    const result = await dialogs.confirm({
      title: action.confirm.title || 'Confirm',
      message: action.confirm.message || 'Are you sure?',
      messageDetails: action.confirm.messageDetails,
      restoreDiff: action.confirm.restoreDiff,
      confirmLabel: action.confirm.confirmLabel || action.label,
      tone: action.style === 'primary' || action.style === 'accent' ? 'primary' : 'danger'
    })
    return result === 'primary' ? action : null
  }
  const confirmed = await modal.confirm({
    title: action.confirm.title || 'Confirm',
    message: action.confirm.message || 'Are you sure?',
    messageDetails: action.confirm.messageDetails,
    confirmLabel: action.label,
    confirmStyle: action.style || 'danger'
  })
  return confirmed ? action : null
}

export async function runDiskSpaceCheck(
  action: ActionDef,
  installation: Installation,
  modal: Modal,
  t: Translate,
  installationSizeBytes?: number | null,
  dialogs?: Dialogs
): Promise<boolean> {
  const diskCheckActions = new Set(['copy', 'copy-update', 'copy-pytorch', 'release-update'])
  if (!diskCheckActions.has(action.id) || !installation.installPath) return true
  try {
    const space: DiskSpaceInfo = await window.api.getDiskSpace(installation.installPath)
    let estimatedRequired = 0
    if (action.id === 'copy' || action.id === 'copy-update' || action.id === 'copy-pytorch') {
      if (installationSizeBytes != null) {
        estimatedRequired = installationSizeBytes
      } else {
        try {
          const r = await window.api.getInstallationSize(installation.id)
          estimatedRequired = r.sizeBytes
        } catch {}
      }
    }
    const threshold = estimatedRequired > 0 ? Math.ceil(estimatedRequired * 1.1) : 1073741824
    if (space.free < threshold) {
      const freeStr = formatBytes(space.free)
      const message =
        estimatedRequired > 0
          ? t('diskSpace.warningMessage', {
              free: freeStr,
              required: formatBytes(estimatedRequired)
            })
          : t('diskSpace.warningMessageGeneric', { free: freeStr })
      if (dialogs) {
        const result = await dialogs.confirm({
          title: t('diskSpace.warningTitle'),
          message,
          confirmLabel: t('diskSpace.continueAnyway'),
          tone: 'primary'
        })
        if (result !== 'primary') return false
      } else {
        const ok = await modal.confirm({
          title: t('diskSpace.warningTitle'),
          message,
          confirmLabel: t('diskSpace.continueAnyway'),
          confirmStyle: 'primary'
        })
        if (!ok) return false
      }
    }
  } catch {}
  return true
}
