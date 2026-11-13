<script setup lang="ts">
import InstallLocationField from './InstallLocationField.vue'
import SetupFormRow from './SetupFormRow.vue'
import type { DiskSpaceInfo, PathIssue } from '../types/ipc'

const props = withDefaults(
  defineProps<{
    path: string
    label?: string
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
    label: undefined,
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
  <SetupFormRow :label="label ?? $t('common.location')" data-testid="install-location-field">
    <InstallLocationField
      :path="props.path"
      :placeholder="props.placeholder"
      :browse-test-id="props.browseTestId"
      :free-label="props.freeLabel"
      :short-label="props.shortLabel"
      :path-issues="props.pathIssues"
      :disk-space-loading="props.diskSpaceLoading"
      :disk-space="props.diskSpace"
      :estimated-size="props.estimatedSize"
      @browse="$emit('browse')"
      @open="$emit('open')"
    />
  </SetupFormRow>
</template>
