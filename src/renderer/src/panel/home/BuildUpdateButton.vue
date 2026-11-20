<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@comfyorg/design-system/button/Button'
import { useBuildMenu } from './useBuildMenu'
import type { Installation } from '../../types/ipc'

const { build } = defineProps<{ build: Installation }>()

const { t } = useI18n()
const { items, run } = useBuildMenu(() => build)
const update = computed(() => items.value.find((item) => item.id === 'update'))

function onClick(): void {
  if (update.value && !update.value.disabled) void run('update')
}
</script>

<template>
  <Button
    v-if="update"
    type="button"
    variant="inverted"
    size="unset"
    class="pointer-events-auto relative -my-px h-[19px] shrink-0 rounded-full px-2 text-[11px]/none font-medium focus-visible:ring-2 disabled:pointer-events-auto disabled:cursor-default"
    :disabled="update.disabled"
    :title="update.title"
    :aria-label="t('chooser.updateBuild', { name: build.name })"
    data-testid="build-update-button"
    @click.stop="onClick"
  >
    {{ t('chooser.updatePill') }}
  </Button>
  <span v-else class="shrink-0" data-testid="build-update-note">{{ t('chooser.updatePill') }}</span>
</template>
