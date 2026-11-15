<script setup lang="ts">
import InputGroup from '@comfyorg/design-system/input-group/InputGroup'
import Button from '@comfyorg/design-system/button/Button'
import PathDiskInfo from './PathDiskInfo.vue'
import PathOpenButton from './PathOpenButton.vue'
import type { DiskSpaceInfo, PathIssue } from '../types/ipc'

withDefaults(
  defineProps<{
    path: string
    placeholder?: string
    browseTestId?: string
    freeLabel?: string
    shortLabel?: string
    pathIssues?: PathIssue[]
    diskSpaceLoading?: boolean
    diskSpace?: DiskSpaceInfo | null
    estimatedSize?: number
  }>(),
  {
    placeholder: '',
    browseTestId: undefined,
    freeLabel: '',
    shortLabel: '',
    pathIssues: () => [],
    diskSpaceLoading: false,
    diskSpace: null,
    estimatedSize: 0
  }
)

defineEmits<{ browse: []; open: [] }>()
</script>

<template>
  <div class="install-location-field flex min-w-0 flex-col">
    <InputGroup
      class="config-input config-path-input min-w-0 gap-2.5 pr-1.5 pl-3 text-[13px]"
      data-testid="config-path-input"
    >
      <PathOpenButton v-if="path" class="flex-1" :path="path" @open="$emit('open')" />
      <span v-else class="config-path-placeholder min-w-0 flex-1 truncate text-text-muted">{{
        placeholder
      }}</span>
      <span
        v-if="freeLabel"
        class="config-path-free flex-none text-[12px] whitespace-nowrap text-text-muted"
        >{{ freeLabel }}</span
      >
      <Button
        size="sm"
        variant="secondary"
        type="button"
        class="config-path-browse flex-none rounded-lg bg-white/10 hover:bg-white/14"
        :data-testid="browseTestId"
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
</template>
