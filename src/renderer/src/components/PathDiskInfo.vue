<script setup lang="ts">
import type { PathIssue, DiskSpaceInfo } from '../types/ipc'
import { formatBytes } from '../lib/formatting'

defineProps<{
  pathIssues: PathIssue[]
  diskSpaceLoading: boolean
  diskSpace: DiskSpaceInfo | null
  estimatedSize: number
}>()
</script>

<template>
  <div
    v-if="pathIssues.includes('insideAppBundle')"
    class="path-disk-error mt-1 min-h-0 text-[13px] text-[var(--danger)]"
  >
    {{ $t('pathValidation.insideAppBundleMessage') }}
  </div>
  <div
    v-else-if="pathIssues.includes('oneDrive')"
    class="path-disk-error mt-1 min-h-0 text-[13px] text-[var(--danger)]"
  >
    {{ $t('pathValidation.oneDriveMessage') }}
  </div>
  <div
    v-else-if="pathIssues.includes('insideSharedDir')"
    class="path-disk-error mt-1 min-h-0 text-[13px] text-[var(--danger)]"
  >
    {{ $t('pathValidation.insideSharedDirMessage') }}
  </div>
  <div
    v-else-if="pathIssues.includes('insideExistingInstall')"
    class="path-disk-error mt-1 min-h-0 text-[13px] text-[var(--danger)]"
  >
    {{ $t('pathValidation.insideExistingInstallMessage') }}
  </div>
  <div class="path-disk-info mt-1 min-h-[18px] text-[13px] text-text-muted">
    <template v-if="diskSpaceLoading">
      {{ $t('diskSpace.checking') }}
    </template>
    <template v-else-if="diskSpace">
      {{ $t('diskSpace.free', { size: formatBytes(diskSpace.free) }) }}
      <template v-if="estimatedSize > 0">
        · {{ $t('diskSpace.estimatedRequired', { size: formatBytes(estimatedSize) }) }}
      </template>
    </template>
  </div>
</template>
