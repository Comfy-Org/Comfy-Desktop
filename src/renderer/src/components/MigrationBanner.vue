<script setup lang="ts">
import { ref } from 'vue'
import Button from '@comfyorg/design-system/button/Button'
import { useI18n } from 'vue-i18n'
import { useMigrateAction } from '../composables/useMigrateAction'
import { ArrowRightLeft, Download } from 'lucide-vue-next'
import type { Installation, ShowProgressOpts } from '../types/ipc'

const buttonClass =
  'static inline-flex appearance-auto items-center justify-normal gap-2 rounded-lg border border-solid px-6 py-2.5 font-sans text-[14px] leading-[inherit] font-normal whitespace-normal touch-auto transition-none [&]:[appearance:button] disabled:pointer-events-auto disabled:cursor-default disabled:opacity-40 focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] [&_svg]:shrink'
const primaryClass =
  'border-[var(--accent-primary)] bg-[var(--accent-primary)] font-medium text-background enabled:hover:border-[var(--accent-hover)] enabled:hover:bg-[var(--accent-hover)] disabled:hover:border-[color-mix(in_srgb,var(--accent-primary)_85%,#000)] disabled:hover:bg-[color-mix(in_srgb,var(--accent-primary)_85%,#000)] hover:transition-[background,border-color] hover:duration-120 hover:ease-[ease]'
const secondaryClass = 'border-[var(--border)] bg-surface text-text hover:bg-[var(--border)]'

const props = defineProps<{
  installation: Installation
}>()

const emit = defineEmits<{
  'show-progress': [opts: ShowProgressOpts]
  'show-settings': []
  'show-quick-install': []
}>()

const { t } = useI18n()
const { confirmMigration } = useMigrateAction()
const migrating = ref(false)

async function startMigration(): Promise<void> {
  if (migrating.value) return
  migrating.value = true
  try {
    const result = await confirmMigration(props.installation)
    if (!result) return

    emit('show-progress', {
      installationId: props.installation.id,
      title: `${t('desktop.migrating')} — ${props.installation.name}`,
      apiCall: () => window.api.runAction(props.installation.id, 'migrate-to-standalone', result),
      cancellable: true,
      opKind: 'update'
    })
  } finally {
    migrating.value = false
  }
}
</script>

<template>
  <div class="migration-banner flex flex-col items-center justify-center px-5 py-20 text-center">
    <div class="migration-banner-icon mb-5 text-text-muted">
      <ArrowRightLeft :size="48" />
    </div>

    <h1 class="migration-banner-title mb-2 text-[28px] font-bold text-text">
      {{ $t('dashboard.migrateBannerTitle') }}
    </h1>
    <p class="migration-banner-desc mb-7 max-w-[400px] text-[16px] text-text-muted">
      {{ $t('dashboard.migrateBannerDesc') }}
    </p>
    <Button
      size="unset"
      variant="inverted"
      :class="[buttonClass, primaryClass]"
      class="migration-start"
      :disabled="migrating"
      @click="startMigration"
    >
      <ArrowRightLeft :size="18" />
      {{ $t('dashboard.migrateBannerAction') }}
    </Button>
    <Button
      size="unset"
      variant="secondary"
      :class="[buttonClass, secondaryClass]"
      class="migration-skip mt-2.5"
      @click="emit('show-quick-install')"
    >
      <Download :size="18" />
      {{ $t('dashboard.migrateBannerSkip') }}
    </Button>

    <p
      class="migration-telemetry-notice mt-7 max-w-[460px] text-[13px] leading-[1.4] text-text-muted"
    >
      {{ $t('dashboard.telemetryNotice') }}
      <Button
        size="unset"
        variant="textonly"
        class="migration-telemetry-link static ml-1.5 inline-block appearance-auto rounded-lg border-0 bg-transparent p-0 font-sans text-[13px] leading-[inherit] font-normal whitespace-normal text-[var(--accent)] underline touch-auto transition-none [&]:[appearance:button] hover:bg-transparent hover:text-[var(--accent-hover)] focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto]"
        @click="emit('show-settings')"
      >
        {{ $t('dashboard.telemetrySettings') }}
      </Button>
    </p>
  </div>
</template>
