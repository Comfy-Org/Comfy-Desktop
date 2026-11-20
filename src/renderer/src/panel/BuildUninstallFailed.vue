<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { OctagonAlert } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'

const {
  reason,
  title = '',
  kind = 'uninstall',
  dismissLabel = '',
  retryLabel = ''
} = defineProps<{
  reason: string
  title?: string
  kind?: 'uninstall' | 'operation' | 'start'
  dismissLabel?: string | null
  retryLabel?: string
}>()

const emit = defineEmits<{ retry: []; dismiss: [] }>()

const { t } = useI18n()
</script>

<template>
  <section
    class="flex shrink-0 items-center gap-4 rounded-[14px] bg-[color-mix(in_oklch,var(--color-destructive)_9%,color-mix(in_oklch,var(--color-foreground)_6%,var(--color-content-background)))] px-[18px] py-4"
    role="alert"
    :data-testid="`build-${kind}-failed`"
  >
    <div class="flex min-w-0 flex-1 items-start gap-3">
      <span class="flex h-[21px] shrink-0 items-center" aria-hidden="true">
        <OctagonAlert :size="18" class="text-destructive" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col">
        <h2 class="m-0 text-[15px]/[21px] font-semibold text-foreground">
          {{ title || t('uninstallProgress.failedTitle') }}
        </h2>
        <p
          v-if="reason"
          class="m-0 mt-1 max-h-60 overflow-y-auto text-[13px]/5 break-words whitespace-pre-line text-muted-foreground select-text"
          :data-testid="`build-${kind}-failed-reason`"
        >
          {{ reason }}
        </p>
      </div>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <Button
        v-if="dismissLabel !== null"
        type="button"
        variant="muted-textonly"
        size="unset"
        class="h-8 rounded-lg px-3 text-[13px]/5 font-normal hover:bg-secondary hover:text-foreground"
        :data-testid="`build-${kind}-dismiss`"
        @click="emit('dismiss')"
      >
        {{ dismissLabel || t('uninstallProgress.dismiss') }}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="unset"
        class="h-8 rounded-lg px-3 text-[13px]/5 font-normal"
        :data-testid="`build-${kind}-retry`"
        @click="emit('retry')"
      >
        {{ retryLabel || t('uninstallProgress.tryAgain') }}
      </Button>
    </div>
  </section>
</template>
