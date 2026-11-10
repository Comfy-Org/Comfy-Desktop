<script setup lang="ts">
defineProps<{
  title: string
  description: string
}>()
</script>

<template>
  <header
    class="branded-page-header box-border flex w-full items-center gap-7 @max-[700px]:flex-col @max-[700px]:items-start @max-[700px]:gap-2"
  >
    <div>
      <h1 class="m-0 mb-1 text-[24px] leading-[1.2] font-semibold text-neutral-100">{{ title }}</h1>
      <p class="branded-page-header__description m-0 text-[14px] text-text-muted">
        {{ description }}
      </p>
    </div>
    <div
      v-if="$slots.actions"
      class="branded-page-header__actions ml-auto flex flex-none items-center gap-2 @max-[700px]:ml-0"
    >
      <slot name="actions" />
    </div>
  </header>
</template>
