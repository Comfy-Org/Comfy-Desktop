<script setup lang="ts">
import Button from '@comfyorg/design-system/button/Button'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseInput from '../../components/ui/BaseInput.vue'
import type { DraftAppPasteAnswer } from '../../types/ipc'
import GlobalSettingsMicroSection from './GlobalSettingsMicroSection.vue'

interface DevelopmentBridge {
  close(): void
  globalSettingsOpenDraftApp(address: string): Promise<DraftAppPasteAnswer | null>
}

const { t } = useI18n()
const bridge = (window as unknown as { __comfyTitlePopup?: DevelopmentBridge }).__comfyTitlePopup

const address = ref('')
const opening = ref(false)
const refusal = ref<{ title: string; message: string } | null>(null)

const canOpen = computed(() => address.value.trim().length > 0 && !opening.value)

function handleInput(value: string): void {
  address.value = value
  refusal.value = null
}

function failedToCheck(): DraftAppPasteAnswer {
  return {
    kind: 'refused',
    title: t('settings.draftAppFailedTitle'),
    message: t('settings.draftAppFailedMessage')
  }
}

async function handleOpen(): Promise<void> {
  if (!canOpen.value) return
  const submitted = address.value.trim()
  opening.value = true
  refusal.value = null
  try {
    const answer = await bridge?.globalSettingsOpenDraftApp(submitted).catch(() => failedToCheck())
    if (answer?.kind === 'asked') {
      bridge?.close()
      return
    }
    if (answer?.kind === 'refused' && address.value.trim() === submitted) {
      refusal.value = { title: answer.title, message: answer.message }
    }
  } finally {
    opening.value = false
  }
}
</script>

<template>
  <GlobalSettingsMicroSection :title="t('settings.draftAppsTitle')">
    <form class="gs-draft-app flex flex-col gap-1.5" @submit.prevent="handleOpen">
      <span class="gs-draft-app-label text-[12px] leading-4 font-normal text-text-muted">
        {{ t('settings.draftAppAddress') }}
      </span>
      <div class="flex items-center gap-2">
        <BaseInput
          class="gs-draft-app-input min-w-0 flex-auto"
          :model-value="address"
          :placeholder="t('settings.draftAppPlaceholder')"
          :aria-label="t('settings.draftAppAddress')"
          :invalid="refusal !== null"
          :spellcheck="false"
          mono
          @update:model-value="handleInput"
        />
        <Button
          type="submit"
          variant="secondary"
          size="md"
          class="gs-draft-app-open flex-none"
          :disabled="!canOpen"
        >
          {{ t('settings.open') }}
        </Button>
      </div>
      <div
        v-if="refusal"
        class="gs-draft-app-refusal flex flex-col gap-0.5 rounded-md bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-2.5 py-1.5 text-[12px] leading-[1.5] text-danger"
        role="alert"
      >
        <strong class="font-medium">{{ refusal.title }}</strong>
        <span>{{ refusal.message }}</span>
      </div>
    </form>
  </GlobalSettingsMicroSection>
</template>
