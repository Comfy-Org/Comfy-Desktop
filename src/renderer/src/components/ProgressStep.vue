<script setup lang="ts">
defineProps<{
  phase: string
  label: string
  status: 'pending' | 'active' | 'done'
  statusText?: string
  percent?: number
  summaryText?: string
  stepNumber: number
  error?: string
}>()
</script>

<template>
  <div
    class="progress-step flex flex-col rounded-md px-3 py-2"
    :class="[
      status,
      status === 'active'
        ? 'bg-surface opacity-100'
        : status === 'done'
          ? 'opacity-70'
          : 'opacity-40'
    ]"
    :data-phase="phase"
  >
    <div class="progress-step-header flex items-center gap-2.5">
      <span
        class="progress-step-indicator flex size-[22px] shrink-0 items-center justify-center rounded-[50%] border-2 border-solid text-[12px] font-semibold"
        :class="
          status === 'done'
            ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg)]'
            : status === 'active'
              ? 'border-[var(--accent)] text-[var(--accent)]'
              : 'border-[var(--border)] text-text-muted'
        "
      >
        {{ status === 'done' ? '✓' : stepNumber }}
      </span>
      <span
        class="progress-step-label text-[14px] font-medium"
        :class="status === 'active' ? 'text-text' : 'text-text-muted'"
        >{{ label }}</span
      >
    </div>
    <div v-if="status === 'active'" class="progress-step-detail mt-1.5 ml-8">
      <div
        class="progress-step-status mb-1.5 max-h-[50vh] overflow-y-auto text-[13px] whitespace-pre-wrap text-text-muted select-text"
      >
        {{ error ?? statusText }}
      </div>
      <div
        v-if="!error"
        class="progress-bar-track mb-4 h-2 w-full overflow-hidden rounded-[4px] bg-[var(--border)]"
      >
        <div
          class="progress-bar-fill h-full rounded-[4px] bg-[var(--accent)] transition-[width] duration-300 ease-[ease]"
          :class="{ indeterminate: (percent ?? -1) < 0 }"
          :style="{ width: (percent ?? -1) >= 0 ? `${percent}%` : '100%' }"
        ></div>
      </div>
    </div>
    <div
      v-if="status === 'done' && summaryText"
      class="progress-step-summary mt-0.5 ml-8 text-[13px] text-text-muted select-text"
    >
      {{ summaryText }}
    </div>
  </div>
</template>
