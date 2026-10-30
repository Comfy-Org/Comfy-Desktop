<script setup lang="ts">
import ComfyWordmark from './icons/ComfyWordmark.vue'

defineProps<{
  title: string
  description: string
  logoTestId?: string
}>()
</script>

<template>
  <header
    class="branded-page-header box-border flex w-full items-center gap-7 pr-[280px] [@media(max-width:800px)]:flex-col [@media(max-width:800px)]:items-start [@media(max-width:800px)]:gap-2 [@media(max-width:800px)]:pr-0"
  >
    <ComfyWordmark
      class="branded-page-header__wordmark block aspect-[173/48] h-auto w-[clamp(120px,8vw,180px)] shrink-0 text-comfy-yellow [anchor-name:--brand-beam-target]"
      :data-testid="logoTestId"
      aria-hidden="true"
    />
    <div>
      <h1 class="m-0 mb-1 text-[24px] leading-[1.2] font-semibold text-neutral-100">{{ title }}</h1>
      <p class="branded-page-header__description m-0 text-[14px] text-text-muted">
        {{ description }}
      </p>
    </div>
  </header>
</template>
