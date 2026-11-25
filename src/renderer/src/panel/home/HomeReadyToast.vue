<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { X } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'

const emit = defineEmits<{ open: []; dismiss: [] }>()

const { t } = useI18n()
</script>

<template>
  <div
    class="flex items-center gap-3 rounded-xl bg-popover py-2 pr-2 pl-3.5 text-[13px]/5 text-foreground shadow-popover animate-pop-in motion-reduce:animate-none"
    role="status"
    aria-live="polite"
    data-testid="home-ready-toast"
  >
    <span
      class="size-1.5 shrink-0 rounded-full bg-[#59d38c] shadow-[0_0_0_3px_rgb(89_211_140/0.36)]"
      aria-hidden="true"
      data-testid="home-ready-toast-dot"
    />
    <span class="font-medium whitespace-nowrap">{{ t('home.comfyReady') }}</span>
    <Button
      type="button"
      variant="inverted"
      size="sm"
      class="ml-1 px-2.5 focus-visible:ring-2"
      data-testid="home-ready-toast-open"
      @click="emit('open')"
    >
      {{ t('home.comfyReadyOpen') }}
    </Button>
    <Button
      type="button"
      variant="muted-textonly"
      size="unset"
      class="size-6 rounded-md p-0 hover:text-foreground focus-visible:ring-2"
      :aria-label="t('home.comfyReadyDismiss')"
      :title="t('home.comfyReadyDismiss')"
      data-testid="home-ready-toast-dismiss"
      @click="emit('dismiss')"
    >
      <X :size="14" aria-hidden="true" />
    </Button>
  </div>
</template>
