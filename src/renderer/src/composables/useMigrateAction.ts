import { toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { useModal } from './useModal'
import { useActionGuard } from './useActionGuard'
import { useAdoptAction } from './useAdoptAction'
import { useSessionStore } from '../stores/sessionStore'
import { augmentMessageWithStopWarning } from '../lib/stopWarning'
import { findBestVariant } from '../lib/variants'
import type { Installation, FieldOption, SnapshotDetailData } from '../types/ipc'

export interface MigrateActionResult {
  snapshotPath?: string
  enablePipSync: boolean
  target?: {
    mode: 'selected'
    release: FieldOption
    variant: FieldOption
  }
  [key: string]: unknown
}

interface MigrateConfirmOptions {
  title?: string
  message?: string
  confirmLabel?: string
  express?: boolean
}

export interface MigrateTakeoverSurface {
  open: (
    title: string,
    confirmLabel: string
  ) => Promise<{
    confirmed: boolean
    checkboxValues: Record<string, boolean>
  }>
  update: (opts: {
    loading?: boolean
    preview?: SnapshotDetailData
    details?: { label: string; items: string[] }[]
    checkboxes?: { id: string; label: string; checked: boolean }[]
  }) => void
}

let registeredTakeover: MigrateTakeoverSurface | null = null

export function registerMigrateTakeover(surface: MigrateTakeoverSurface | null): void {
  registeredTakeover = surface
}

export function getRegisteredMigrateTakeover(): MigrateTakeoverSurface | null {
  return registeredTakeover
}

export function useMigrateAction(opts?: { surface?: 'modal' | 'takeover' }) {
  const { t } = useI18n()
  const modal = useModal()
  const actionGuard = useActionGuard()
  const adoptAction = useAdoptAction(opts)
  const sessionStore = useSessionStore()
  const surface: 'modal' | 'takeover' = opts?.surface ?? 'modal'

  async function confirmMigration(
    installation: Installation,
    confirm?: MigrateConfirmOptions
  ): Promise<MigrateActionResult | null> {
    if (installation.sourceId === 'desktop') {
      const confirmed = await adoptAction.confirmAdoption(installation, confirm)
      if (confirmed !== true) return null
      return { enablePipSync: false }
    }

    if (!(await actionGuard.checkBeforeAction(installation.id, t('migrate.migrateToStandalone')))) {
      return null
    }

    const isExpress = confirm?.express === true
    const useTakeover = !isExpress && surface === 'takeover' && registeredTakeover !== null
    const takeover = useTakeover ? registeredTakeover! : null
    const wasRunning = sessionStore.isRunning(installation.id)

    const dialogTitle = confirm?.title || t('migrate.migrateToStandaloneConfirmTitle')
    const dialogConfirmLabel = confirm?.confirmLabel || t('migrate.migrateToStandaloneConfirm')
    const dialogMessage = wasRunning
      ? augmentMessageWithStopWarning(
          confirm?.message,
          t('errors.willStopRunning', { name: installation.name || 'ComfyUI' })
        )
      : confirm?.message || ''

    const migrateItems = [
      t('migrate.mergeUserData'),
      t('migrate.mergeInput'),
      t('migrate.mergeOutput'),
      t('migrate.addModels')
    ]

    let surfacePromise: Promise<{ confirmed: boolean; checkboxValues: Record<string, boolean> }>
    if (isExpress) {
      surfacePromise = Promise.resolve({ confirmed: true, checkboxValues: {} })
    } else if (takeover) {
      surfacePromise = takeover.open(dialogTitle, dialogConfirmLabel)
    } else {
      const modalConfirmPromise = modal.confirm({
        title: dialogTitle,
        message: dialogMessage,
        loading: true,
        confirmLabel: dialogConfirmLabel,
        confirmStyle: 'primary'
      })
      surfacePromise = modalConfirmPromise.then((confirmed) => ({
        confirmed,
        checkboxValues: modal.getLastCheckboxValues()
      }))
    }

    let previewResult: Awaited<ReturnType<typeof window.api.previewLocalMigration>>
    try {
      previewResult = await window.api.previewLocalMigration(installation.id)
    } catch (err) {
      if (takeover) takeover.update({ loading: false })
      else if (!isExpress) modal.close(false)
      await modal.alert({
        title: t('migrate.migrateToStandalone'),
        message: (err as Error)?.message ?? String(err)
      })
      return null
    }
    if (!previewResult.ok) {
      if (takeover) takeover.update({ loading: false })
      else if (!isExpress) modal.close(false)
      if (previewResult.message) {
        await modal.alert({
          title: t('migrate.migrateToStandalone'),
          message: previewResult.message
        })
      }
      return null
    }

    const detailsPayload = wasRunning
      ? [
          {
            label: t('migrate.migrationWill'),
            items: [
              t('errors.willStopRunning', { name: installation.name || 'ComfyUI' }),
              ...migrateItems
            ]
          }
        ]
      : [{ label: t('migrate.migrationWill'), items: migrateItems }]
    const checkboxesPayload = [
      { id: 'enablePipSync', label: t('migrate.enablePipSync'), checked: false }
    ]

    if (takeover) {
      takeover.update({
        loading: false,
        preview: previewResult.preview?.newestSnapshot,
        details: detailsPayload,
        checkboxes: checkboxesPayload
      })
    } else if (!isExpress) {
      modal.updateConfirm({
        loading: false,
        snapshotPreview: previewResult.preview?.newestSnapshot,
        messageDetails: detailsPayload,
        checkboxes: checkboxesPayload
      })
    }

    let migrateRelease: FieldOption | null = null
    let autoPickedVariant: FieldOption | null = null
    try {
      const releaseOptions = await window.api.getFieldOptions(
        'standalone',
        'release',
        {},
        { includeLatestStable: true }
      )
      migrateRelease = releaseOptions[0] || null
      if (migrateRelease) {
        const variantOptions = await window.api.getFieldOptions('standalone', 'variant', {
          release: toRaw(migrateRelease)
        })
        const snapshotVariantId = previewResult.preview?.newestSnapshot.comfyui.variant || ''
        autoPickedVariant = findBestVariant(variantOptions, snapshotVariantId)
      }
    } catch {}

    const { confirmed, checkboxValues } = await surfacePromise
    if (!confirmed) return null

    const result: MigrateActionResult = {
      snapshotPath: previewResult.snapshotPath,
      enablePipSync: !!checkboxValues.enablePipSync
    }
    if (autoPickedVariant && migrateRelease) {
      result.target = {
        mode: 'selected',
        release: toRaw(migrateRelease),
        variant: toRaw(autoPickedVariant)
      }
    }

    return result
  }

  return { confirmMigration }
}
