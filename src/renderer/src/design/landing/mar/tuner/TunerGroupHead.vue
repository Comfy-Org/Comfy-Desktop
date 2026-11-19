<script setup lang="ts">
/** UI Playground: a group's title, a dot while any of its tweaks is off
 *  its default, and a Reset for them. */
const { title, note, changed } = defineProps<{
  title: string
  note?: string
  changed: boolean
}>()
defineEmits<{ reset: [] }>()
</script>

<template>
  <div class="flex h-6 items-center gap-1.5">
    <h3 class="min-w-0 truncate text-ui font-medium text-base-foreground">
      {{ title }}<span v-if="note" class="font-normal text-subtle-foreground"> · {{ note }}</span>
    </h3>
    <template v-if="changed">
      <span
        role="img"
        aria-label="Changed from default"
        title="Changed from default"
        class="size-1.5 shrink-0 rounded-full bg-muted-foreground"
      />
      <button
        type="button"
        class="ml-auto shrink-0 rounded-[5px] px-1 text-ui font-normal text-subtle-foreground outline-none hover:text-base-foreground focus-visible:ring-2 focus-visible:ring-border-focus"
        @click.prevent.stop="$emit('reset')"
      >
        Reset
      </button>
    </template>
  </div>
</template>
