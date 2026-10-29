<script setup lang="ts">
import { ref } from 'vue'
import Button from '@comfyorg/design-system/button/Button'
import { useElectronApi } from '../composables/useElectronApi'

const buttonClass =
  'static appearance-auto gap-0 rounded-lg border border-solid px-4 py-2 font-sans text-[14px] leading-[inherit] font-normal whitespace-normal touch-auto transition-none [&]:[appearance:button] disabled:pointer-events-auto disabled:cursor-default disabled:opacity-40 focus-visible:ring-0 focus-visible:outline-1 focus-visible:[outline-style:auto] shrink-0'
const primaryClass =
  'border-[var(--accent-primary)] bg-[var(--accent-primary)] font-medium text-background enabled:hover:border-[var(--accent-hover)] enabled:hover:bg-[var(--accent-hover)] disabled:hover:border-[color-mix(in_srgb,var(--accent-primary)_85%,#000)] disabled:hover:bg-[color-mix(in_srgb,var(--accent-primary)_85%,#000)] hover:transition-[background,border-color] hover:duration-120 hover:ease-[ease]'
const secondaryClass = 'border-[var(--border)] bg-surface text-text hover:bg-[var(--border)]'

const { api, listen } = useElectronApi()

const visible = ref(false)

listen<number>(api.onZoomChanged, (level) => {
  visible.value = level !== 0
})

async function reset() {
  await api.resetZoom()
  visible.value = false
}

function dismiss() {
  visible.value = false
}
</script>

<template>
  <div
    v-if="visible"
    class="zoom-banner flex items-center gap-3 rounded-lg border border-solid border-[var(--border)] bg-surface px-3.5 py-2.5 text-[14px] text-text-muted"
  >
    <span>{{ $t('zoom.changed') }}</span>
    <div class="zoom-banner-actions ml-auto flex gap-2">
      <Button size="unset" variant="inverted" :class="[buttonClass, primaryClass]" @click="reset">
        {{ $t('zoom.reset') }}
      </Button>
      <Button
        size="unset"
        variant="secondary"
        :class="[buttonClass, secondaryClass]"
        @click="dismiss"
      >
        {{ $t('zoom.dismiss') }}
      </Button>
    </div>
  </div>
</template>
