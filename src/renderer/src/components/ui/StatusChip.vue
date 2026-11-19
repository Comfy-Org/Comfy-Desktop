<script setup lang="ts">
const { tone = 'quiet' } = defineProps<{
  tone?: 'go' | 'bad' | 'warn' | 'quiet'
}>()

const TONES = {
  go: 'bg-success/14 text-success',
  bad: 'bg-destructive/16 text-destructive',
  warn: 'bg-warning/15 text-warning',
  quiet: 'bg-foreground/7 text-muted-foreground'
}
</script>

<template>
  <span
    class="inline-flex h-5 shrink-0 items-center gap-[5px] rounded-full px-2 text-[11px] leading-none font-medium whitespace-nowrap"
    :class="TONES[tone]"
  >
    <slot name="icon">
      <span
        class="size-1.5 rounded-full bg-current"
        :class="tone === 'go' && 'animate-status-breathe motion-reduce:animate-none'"
        aria-hidden="true"
      />
    </slot>
    <slot />
  </span>
</template>
