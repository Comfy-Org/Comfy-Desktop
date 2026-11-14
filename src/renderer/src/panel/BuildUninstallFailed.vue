<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { OctagonAlert } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'

const { reason } = defineProps<{ reason: string }>()

const emit = defineEmits<{ retry: []; dismiss: [] }>()

const { t } = useI18n()
</script>

<template>
  <section
    class="flex min-h-25 shrink-0 items-center gap-[18px] rounded-2xl border border-destructive/25 bg-[rgb(137_137_137/0.05)] px-[18px] py-4"
    role="alert"
    data-testid="build-uninstall-failed"
  >
    <OctagonAlert :size="18" class="shrink-0 self-start text-destructive" aria-hidden="true" />
    <div class="flex min-w-0 flex-1 flex-col">
      <h2 class="m-0 text-[15px]/[21px] font-semibold text-foreground">
        {{ t('uninstallProgress.failedTitle') }}
      </h2>
      <p
        class="m-0 mt-1 text-[13px]/5 break-words whitespace-pre-line text-muted-foreground select-text"
        data-testid="build-uninstall-failed-reason"
      >
        {{ reason }}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <Button
        type="button"
        variant="muted-textonly"
        size="unset"
        class="h-8 rounded-lg px-3 text-[13px]/5 font-normal hover:bg-secondary hover:text-foreground"
        data-testid="build-uninstall-dismiss"
        @click="emit('dismiss')"
      >
        {{ t('uninstallProgress.dismiss') }}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="unset"
        class="h-8 rounded-lg px-3 text-[13px]/5 font-normal"
        data-testid="build-uninstall-retry"
        @click="emit('retry')"
      >
        {{ t('uninstallProgress.tryAgain') }}
      </Button>
    </div>
  </section>
</template>
