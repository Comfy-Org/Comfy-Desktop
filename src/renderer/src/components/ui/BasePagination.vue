<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  PaginationEllipsis,
  PaginationList,
  PaginationListItem,
  PaginationNext,
  PaginationPrev,
  PaginationRoot
} from 'reka-ui'
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import BaseSelect from './BaseSelect.vue'

const {
  total,
  totalIsLowerBound = false,
  pageSizes,
  pageSizeLabel,
  testIdPrefix
} = defineProps<{
  total: number
  totalIsLowerBound?: boolean
  pageSizes: readonly number[]
  pageSizeLabel: string
  testIdPrefix: string
}>()
const page = defineModel<number>('page', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })

const { t } = useI18n()

const range = computed(() =>
  t(totalIsLowerBound ? 'common.pagination.rangeLowerBound' : 'common.pagination.range', {
    first: (page.value - 1) * pageSize.value + 1,
    last: Math.min(page.value * pageSize.value, total),
    total
  })
)

const pageSizeOptions = computed(() =>
  pageSizes.map((size) => ({ value: String(size), label: String(size) }))
)
</script>

<template>
  <div
    class="flex items-center justify-between gap-4 pt-8"
    :data-testid="`${testIdPrefix}-pagination`"
  >
    <PaginationRoot
      v-model:page="page"
      :total="total"
      :items-per-page="pageSize"
      :sibling-count="1"
      show-edges
      :aria-label="t('common.pagination.label')"
      class="flex min-w-0 items-center gap-3"
    >
      <PaginationList v-slot="{ items }" class="flex items-center gap-1">
        <PaginationPrev as-child>
          <Button
            type="button"
            variant="muted-textonly"
            size="icon"
            :aria-label="t('common.pagination.previous')"
            :title="t('common.pagination.previous')"
          >
            <ChevronLeft :size="15" aria-hidden="true" />
          </Button>
        </PaginationPrev>
        <template v-for="(item, index) in items" :key="index">
          <PaginationListItem v-if="item.type === 'page'" :value="item.value" as-child>
            <Button
              type="button"
              :variant="item.value === page ? 'secondary' : 'muted-textonly'"
              size="icon"
              class="text-ui tabular-nums"
              :aria-label="t('common.pagination.page', { page: item.value })"
              :data-testid="`${testIdPrefix}-page-${item.value}`"
            >
              {{ item.value }}
            </Button>
          </PaginationListItem>
          <PaginationEllipsis
            v-else
            :index="index"
            class="flex size-8 items-center justify-center text-ui text-subtle-foreground"
          >
            …
          </PaginationEllipsis>
        </template>
        <PaginationNext as-child>
          <Button
            type="button"
            variant="muted-textonly"
            size="icon"
            :aria-label="t('common.pagination.next')"
            :title="t('common.pagination.next')"
          >
            <ChevronRight :size="15" aria-hidden="true" />
          </Button>
        </PaginationNext>
      </PaginationList>
      <span class="truncate text-ui text-subtle-foreground tabular-nums" aria-live="polite">
        {{ range }}
      </span>
    </PaginationRoot>
    <BaseSelect
      :model-value="String(pageSize)"
      :options="pageSizeOptions"
      :aria-label="pageSizeLabel"
      :title="pageSizeLabel"
      compact
      class="w-20 shrink-0"
      :data-testid="`${testIdPrefix}-page-size`"
      @update:model-value="pageSize = Number($event)"
    />
  </div>
</template>
