<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useBuildMenu } from './useBuildMenu'
import type { Installation } from '../../types/ipc'

const { build } = defineProps<{ build: Installation }>()

const { t } = useI18n()
const { run } = useBuildMenu(() => build)
</script>

<template>
  <button
    type="button"
    class="pointer-events-auto relative min-w-0 cursor-pointer truncate rounded-sm text-subtle-foreground underline decoration-current/40 underline-offset-2 transition-colors hover:text-foreground hover:decoration-current focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
    data-testid="build-update-link"
    @click.stop="run('update')"
    @keydown.enter.stop
    @keydown.space.stop
  >
    {{ t('chooser.updateAvailable') }}
  </button>
</template>
