<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import { Trash2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { useModal } from '../../composables/useModal'
import GlobalSettingsMicroSection from './GlobalSettingsMicroSection.vue'

interface RemoveAppDataOptions {
  deleteInstances: boolean
  deleteModels: boolean
}

interface RemoveAppDataBridge {
  globalSettingsRemoveAppData(options: RemoveAppDataOptions): void
}

const props = defineProps<{ platform: string }>()

const { t } = useI18n()
const modal = useModal()

const bridge = (window as unknown as { __comfyTitlePopup?: RemoveAppDataBridge }).__comfyTitlePopup

async function handleRemove(): Promise<void> {
  const confirmed = await modal.confirm({
    title: t('settings.removeAppDataConfirmTitle'),
    message: t('settings.removeAppDataConfirmMessage'),
    messageDetails: [
      {
        label: t('settings.removeAppDataKeptLabel'),
        items: [t('settings.removeAppDataKeptFolders'), t('settings.removeAppDataKeptAdded')]
      },
      {
        label: t('settings.removeAppDataAfterLabel'),
        items: [
          props.platform === 'darwin'
            ? t('settings.removeAppDataAfterMac')
            : t('settings.removeAppDataAfterLinux')
        ]
      }
    ],
    checkboxes: [
      { id: 'deleteInstances', label: t('settings.removeAppDataInstances'), checked: false },
      { id: 'deleteModels', label: t('settings.removeAppDataModels'), checked: false }
    ],
    confirmLabel: t('settings.removeAppDataConfirm'),
    confirmStyle: 'danger'
  })
  if (!confirmed) return
  const values = modal.getLastCheckboxValues()
  bridge?.globalSettingsRemoveAppData({
    deleteInstances: values.deleteInstances === true,
    deleteModels: values.deleteModels === true
  })
}
</script>

<template>
  <GlobalSettingsMicroSection :title="t('settings.removeAppDataTitle')">
    <p class="gs-remove-app-data-hint m-0 text-[13px] leading-[1.5] text-text-muted">
      {{ t('settings.removeAppDataHint') }}
    </p>
    <div>
      <Button
        type="button"
        variant="destructive"
        size="md"
        class="gs-remove-app-data-btn"
        @click="handleRemove"
      >
        <Trash2 :size="14" aria-hidden="true" />
        <span>{{ t('settings.removeAppDataButton') }}</span>
      </Button>
    </div>
  </GlobalSettingsMicroSection>
</template>
