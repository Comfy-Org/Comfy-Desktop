<script setup lang="ts">
import InputGroup from '@comfyorg/design-system/input-group/InputGroup'
import Button from '@comfyorg/design-system/button/Button'
import PathDiskInfo from './PathDiskInfo.vue'
import type { DiskSpaceInfo, PathIssue } from '../types/ipc'

defineProps<{
  path: string
  freeLabel: string
  shortLabel: string
  pathIssues: PathIssue[]
  diskSpaceLoading: boolean
  diskSpace: DiskSpaceInfo | null
  estimatedSize: number
}>()

defineEmits<{ browse: []; open: [] }>()
</script>

<template>
  <div
    class="config-form-row config-field grid grid-cols-[148px_minmax(0,1fr)] items-start gap-4 py-3"
    data-testid="install-location-field"
  >
    <label class="config-label pt-2.5 text-[13px] font-medium text-text-muted">{{
      $t('common.location')
    }}</label>
    <div class="flex min-w-0 flex-col">
      <InputGroup
        class="config-input config-path-input min-w-0 gap-2.5 pr-1.5 pl-3"
        data-testid="config-path-input"
      >
        <Button
          v-if="path"
          size="link"
          variant="link"
          type="button"
          class="config-path-open block min-w-0 flex-1 truncate py-0 text-left text-inherit"
          :title="$t('actions.openDirectory')"
          :aria-label="`${$t('actions.openDirectory')}: ${path}`"
          @click="$emit('open')"
        >
          {{ path }}
        </Button>
        <span v-else class="flex-1" />
        <span
          v-if="freeLabel"
          class="config-path-free flex-none text-[12px] whitespace-nowrap text-text-muted"
          >{{ freeLabel }}</span
        >
        <Button
          size="sm"
          variant="secondary"
          type="button"
          class="config-path-browse flex-none"
          @click="$emit('browse')"
        >
          {{ $t('common.browse') }}
        </Button>
      </InputGroup>
      <PathDiskInfo
        issues-only
        :path-issues="pathIssues"
        :disk-space-loading="diskSpaceLoading"
        :disk-space="diskSpace"
        :estimated-size="estimatedSize"
      />
      <p
        v-if="shortLabel"
        class="config-path-required m-0 mt-1 text-[12px] leading-4 text-[var(--warning)]"
      >
        {{ shortLabel }}
      </p>
    </div>
  </div>
</template>
