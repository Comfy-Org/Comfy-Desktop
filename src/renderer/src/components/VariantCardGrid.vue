<script setup lang="ts">
import type { FieldOption } from '../types/ipc'
import { getVariantImage } from '../lib/variants'

defineProps<{
  options: FieldOption[]
  selectedValue?: string | null
}>()

defineEmits<{
  select: [option: FieldOption]
}>()
</script>

<template>
  <div class="variant-cards mt-1 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2.5">
    <div
      v-for="opt in options"
      :key="opt.value"
      role="button"
      tabindex="0"
      :class="[
        'variant-card cursor-pointer rounded-lg border-2 border-solid bg-[var(--surface)] px-3 py-3.5 text-center transition-[border-color] duration-150 ease-[ease]',
        selectedValue === opt.value
          ? 'border-[var(--selected)] hover:border-[var(--selected)]'
          : 'border-[var(--border)] hover:border-[var(--border-hover)]',
        {
          selected: selectedValue === opt.value,
          recommended: opt.recommended
        }
      ]"
      @click="$emit('select', opt)"
      @keydown.enter.prevent="$emit('select', opt)"
      @keydown.space.prevent="$emit('select', opt)"
    >
      <div
        class="variant-card-icon mx-auto mt-0 mb-2.5 flex size-24 items-center justify-center overflow-hidden rounded-xl bg-[var(--bg)]"
      >
        <img
          v-if="getVariantImage(opt)"
          :src="getVariantImage(opt)!"
          :alt="opt.label"
          class="size-full object-cover"
          draggable="false"
        />
        <span v-else class="variant-card-icon-text text-[13px] font-semibold text-text-muted">{{
          opt.label
        }}</span>
      </div>
      <div class="variant-card-label text-base font-semibold text-text">{{ opt.label }}</div>
      <div
        v-if="opt.recommended"
        class="variant-card-badge mt-1.5 inline-block rounded-[3px] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] px-1.5 py-px text-[11px] font-semibold tracking-[0.5px] text-[var(--accent)] uppercase"
      >
        {{ $t('newInstall.recommended') }}
      </div>
      <div v-if="opt.description" class="variant-card-desc mt-1.5 text-[11px] text-text-muted">
        {{ opt.description }}
      </div>
    </div>
  </div>
</template>
