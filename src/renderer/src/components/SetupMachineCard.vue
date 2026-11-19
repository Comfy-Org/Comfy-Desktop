<script setup lang="ts">
import { Check } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import BuildDeviceArt from '../panel/home/BuildDeviceArt.vue'
import { deviceKindForPlatform } from '../panel/home/homeBuild'

const {
  name,
  platform,
  memoryGb = null,
  detected = true,
  blocked = false,
  changeTestid,
  changeDisabled = false
} = defineProps<{
  name: string
  platform: string | undefined
  memoryGb?: number | null
  detected?: boolean
  blocked?: boolean
  changeTestid: string
  changeDisabled?: boolean
}>()

const emit = defineEmits<{ change: [] }>()
</script>

<template>
  <section
    class="setup-machine relative flex items-center gap-5 overflow-hidden rounded-[14px] bg-[rgb(137_137_137/0.05)] px-7 py-6"
    :class="blocked && 'setup-machine--blocked'"
  >
    <span
      class="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_120%_at_15%_0%,rgb(244_244_244/0.09),rgb(244_244_244/0)_70%)]"
      aria-hidden="true"
    />
    <BuildDeviceArt
      class="relative h-[68px] w-[104px] shrink-0 max-[640px]:hidden"
      :kind="deviceKindForPlatform(platform)"
      glow="#46464A"
    />
    <div class="relative flex min-w-0 flex-1 flex-col">
      <span
        v-if="detected"
        class="setup-machine-kicker flex h-[15px] items-center gap-1.5 text-xs/[15px] text-muted-foreground"
      >
        <Check :size="11" :stroke-width="2" aria-hidden="true" />
        {{ $t('setup.detected') }}
      </span>
      <span
        class="mt-[5px] font-semibold"
        :class="
          blocked
            ? 'text-[16px]/6 break-words text-destructive'
            : 'truncate text-[22px]/[27px] text-foreground'
        "
        data-testid="setup-machine-name"
        >{{ name }}</span
      >
      <span
        v-if="memoryGb && !blocked"
        class="mt-[3px] text-[13px]/4 text-subtle-foreground"
        data-testid="setup-machine-memory"
        >{{ $t('setup.memory', { gb: memoryGb }) }}</span
      >
    </div>
    <Button
      size="md"
      variant="secondary"
      type="button"
      class="relative shrink-0 px-3"
      :data-testid="changeTestid"
      :disabled="changeDisabled"
      @click="emit('change')"
    >
      {{ $t('setup.change') }}
    </Button>
  </section>
</template>
