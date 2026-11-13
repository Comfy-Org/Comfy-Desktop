<script setup lang="ts">
import type { Component } from 'vue'
import { Check, Crown } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'

export interface SetupOptionCard {
  value: string
  label: string
  description?: string
  recommended?: boolean
  credits?: boolean
  icon?: Component
  image?: string | null
  testId?: string
  disabled?: boolean
}

withDefaults(
  defineProps<{
    options: SetupOptionCard[]
    selectedValue?: string | null
    ariaLabel?: string
    layout?: 'grid' | 'list'
  }>(),
  { selectedValue: null, ariaLabel: undefined, layout: 'list' }
)

defineEmits<{ select: [value: string] }>()
</script>

<template>
  <div
    class="setup-option-cards grid gap-2"
    :class="layout === 'grid' ? 'grid-cols-2' : 'grid-cols-1'"
    role="radiogroup"
    :aria-label="ariaLabel"
  >
    <Button
      v-for="opt in options"
      :key="opt.value"
      size="unset"
      variant="textonly"
      type="button"
      role="radio"
      :data-testid="opt.testId"
      :aria-checked="selectedValue === opt.value"
      :disabled="opt.disabled"
      :class="[
        'setup-option static flex w-full min-w-0 appearance-auto items-center justify-normal gap-3 rounded-[12px] py-3 pr-3.5 pl-3 text-left [font:inherit] whitespace-normal transition-[background-color] duration-120 ease-[ease] focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] focus-visible:[outline-style:solid] active:transition-none',
        selectedValue === opt.value
          ? 'setup-option--selected bg-white/8 text-neutral-100 [box-shadow:inset_0_0_0_1px_rgb(255_255_255/0.2)] hover:bg-white/8'
          : 'bg-white/5 text-neutral-200 [box-shadow:inset_0_0_0_1px_rgb(255_255_255/0.09)] hover:bg-white/9'
      ]"
      @click="$emit('select', opt.value)"
    >
      <span
        class="setup-option__icon inline-flex size-8 flex-none items-center justify-center overflow-hidden rounded-[9px] bg-white/7"
        :class="selectedValue === opt.value ? 'text-neutral-100' : 'text-text-muted'"
        aria-hidden="true"
      >
        <img
          v-if="opt.image"
          :src="opt.image"
          alt=""
          class="size-full object-cover"
          draggable="false"
        />
        <component :is="opt.icon" v-else-if="opt.icon" :size="16" />
      </span>
      <span class="setup-option__text grid min-w-0 flex-1">
        <span
          class="setup-option__label flex min-w-0 items-center gap-2 text-[13px] leading-5 font-medium text-neutral-100"
        >
          <span class="truncate">{{ opt.label }}</span>
          <span
            v-if="opt.recommended"
            class="setup-option__recommended flex-none rounded-[4px] bg-white/16 px-1.5 py-0.5 text-[10px] leading-[14px] font-semibold tracking-[0.04em] text-text-muted uppercase"
          >
            {{ $t('newInstall.recommended') }}
          </span>
          <span
            v-if="opt.credits"
            class="setup-option__credits inline-flex flex-none items-center gap-1 text-[11px] leading-4 font-medium text-[var(--upgrade)]"
          >
            <Crown :size="12" :stroke-width="2.5" aria-hidden="true" />
            {{ $t('standalone.templateApiBadge') }}
          </span>
        </span>
        <span
          v-if="opt.description"
          class="setup-option__meta truncate text-[12px] leading-4 text-text-muted"
        >
          {{ opt.description }}
        </span>
      </span>
      <Check
        class="setup-option__check size-[18px] flex-none self-start text-neutral-100"
        :class="selectedValue === opt.value ? 'visible' : 'invisible'"
        :size="15"
        :stroke-width="2.5"
        aria-hidden="true"
      />
    </Button>
  </div>
</template>
