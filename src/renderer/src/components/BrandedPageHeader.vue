<script setup lang="ts">
defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <header
    class="branded-page-header box-border flex w-full items-end justify-between gap-6 @max-[700px]:flex-col @max-[700px]:items-start @max-[700px]:gap-3"
  >
    <div class="min-w-0">
      <h1 class="m-0 text-[22px]/[1.4] font-semibold tracking-[-0.01em] text-foreground">
        {{ title }}
      </h1>
      <p
        v-if="description"
        class="branded-page-header__description m-0 mt-1 text-[14px] text-text-muted"
      >
        {{ description }}
      </p>
    </div>
    <div
      v-if="$slots.actions"
      class="branded-page-header__actions flex flex-none items-center gap-2"
    >
      <slot name="actions" />
    </div>
  </header>
</template>
