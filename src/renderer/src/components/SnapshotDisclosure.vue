<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'

defineProps<{ label: string }>()

const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <div
    class="load-snapshot-disclosure group/disclosure rounded-[14px] bg-white/4 px-4 py-2"
    :class="{ 'is-open': open }"
  >
    <Button
      variant="textonly"
      size="unset"
      type="button"
      class="load-snapshot-disclosure__summary static flex w-full items-center justify-start gap-1.5 rounded-md px-0 py-1 text-[13px] leading-5 font-medium text-text-muted hover:bg-transparent hover:text-neutral-100 focus-visible:outline-2 focus-visible:[outline-style:solid] focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 focus-visible:ring-0"
      :aria-expanded="open"
      @click="open = !open"
    >
      <ChevronRight
        :size="14"
        class="load-snapshot-disclosure__chevron transition-transform duration-220 ease-[cubic-bezier(0.22,1,0.36,1)] group-[.is-open]/disclosure:[transform:rotate(90deg)] motion-reduce:transition-none"
        aria-hidden="true"
      />
      <span>{{ label }}</span>
    </Button>
    <div
      class="load-snapshot-disclosure__wrap grid grid-rows-[0fr] transition-[grid-template-rows] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)] group-[.is-open]/disclosure:grid-rows-[1fr] motion-reduce:transition-none"
      :inert="!open"
      :aria-hidden="!open"
    >
      <div
        class="load-snapshot-disclosure__body min-h-0 overflow-hidden opacity-0 [transform:translateY(-4px)] transition-[opacity,transform] [transition-duration:220ms,260ms] [transition-timing-function:ease,cubic-bezier(0.22,1,0.36,1)] [transition-delay:60ms,40ms] group-[.is-open]/disclosure:mt-2 group-[.is-open]/disclosure:opacity-100 group-[.is-open]/disclosure:[transform:translateY(0)] motion-reduce:transition-none"
      >
        <slot />
      </div>
    </div>
  </div>
</template>
