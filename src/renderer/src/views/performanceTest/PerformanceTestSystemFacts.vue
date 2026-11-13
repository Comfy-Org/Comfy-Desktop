<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import PerformanceTestCard from './PerformanceTestCard.vue'

defineProps<{
  facts: { label: string; value: string }[]
}>()

const { t } = useI18n()
</script>

<template>
  <PerformanceTestCard
    class="performance-test__system-section mt-3"
    :title="t('performanceTest.systemInformation')"
  >
    <dl
      class="performance-test__system m-0 grid grid-cols-3 gap-x-6 gap-y-3 @max-[800px]:grid-cols-2 @max-[480px]:grid-cols-1"
    >
      <div
        v-for="fact in facts"
        :key="fact.label"
        class="performance-test__fact flex min-w-0 flex-col gap-0.5"
      >
        <dt class="text-[12px]">{{ fact.label }}</dt>
        <dd class="m-0 truncate text-[var(--text-primary)]" :title="fact.value">
          {{ fact.value }}
        </dd>
      </div>
    </dl>
  </PerformanceTestCard>
</template>
