<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'

const CONTROL_COUNT = 3
const RESULT_COUNT = 3
const BLOCK = 'motion-reduce:animate-none'

const { t } = useI18n()
</script>

<template>
  <div
    class="flex size-full gap-2"
    role="status"
    :aria-label="t('common.loading')"
    data-testid="app-page-skeleton"
  >
    <div class="flex w-90 shrink-0 flex-col gap-5 rounded-shell bg-background px-5 pt-4 pb-5">
      <div class="flex h-8 items-center justify-between">
        <Skeleton :class="[BLOCK, 'h-4 w-16 rounded-full']" />
        <Skeleton :class="[BLOCK, 'h-4 w-28 rounded-full']" />
      </div>
      <div v-for="n in CONTROL_COUNT" :key="n" class="flex flex-col gap-2">
        <Skeleton :class="[BLOCK, 'h-3 w-20 rounded-full']" />
        <Skeleton :class="[BLOCK, 'h-8 w-full rounded-control']" />
      </div>
      <div class="flex flex-col gap-2">
        <Skeleton :class="[BLOCK, 'h-3 w-32 rounded-full']" />
        <Skeleton :class="[BLOCK, 'h-22 w-full rounded-control']" />
      </div>
      <Skeleton :class="[BLOCK, 'mt-auto h-10 w-full rounded-control']" />
    </div>
    <div
      class="flex min-w-0 flex-1 flex-col gap-5 overflow-hidden rounded-shell bg-background px-5 pt-4 pb-5"
    >
      <Skeleton :class="[BLOCK, 'h-8 w-80 max-w-full rounded-control']" />
      <div class="grid grid-cols-3 gap-3">
        <Skeleton
          v-for="n in RESULT_COUNT"
          :key="n"
          :class="[BLOCK, 'aspect-square w-full rounded-card']"
        />
      </div>
    </div>
  </div>
</template>
