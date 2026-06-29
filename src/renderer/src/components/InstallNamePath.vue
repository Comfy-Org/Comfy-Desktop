<script setup lang="ts">
import type { PathIssue, DiskSpaceInfo } from '../types/ipc'
import PathDiskInfo from './PathDiskInfo.vue'

defineProps<{
  name: string
  path: string
  defaultPath: string
  hideInstallPath?: boolean
  pathIssues: PathIssue[]
  diskSpaceLoading: boolean
  diskSpace: DiskSpaceInfo | null
  estimatedSize: number
}>()

defineEmits<{
  'update:name': [value: string]
  'update:path': [value: string]
  browse: []
  open: []
}>()
</script>

<template>
  <div class="field">
    <label for="inst-name">{{ $t('common.name') }}</label>
    <input
      id="inst-name"
      :value="name"
      type="text"
      :placeholder="$t('common.namePlaceholder')"
      @input="$emit('update:name', ($event.target as HTMLInputElement).value)"
    />
  </div>

  <div
    v-if="!hideInstallPath"
    class="field"
  >
    <label>{{ $t('newInstall.installLocation') }}</label>
    <div class="path-input">
      <div class="path-open-wrap">
        <button
          v-if="path"
          type="button"
          class="open-folder-link path-open"
          :title="$t('actions.openDirectory', 'Open Directory')"
          :aria-label="`${$t('actions.openDirectory', 'Open Directory')}: ${path}`"
          @click="$emit('open')"
        >{{ path }}</button>
      </div>
      <button @click="$emit('browse')">{{ $t('common.browse') }}</button>
      <button
        v-if="path !== defaultPath"
        @click="$emit('update:path', defaultPath)"
      >{{ $t('common.resetDefault') }}</button>
    </div>
    <PathDiskInfo
      :path-issues="pathIssues"
      :disk-space-loading="diskSpaceLoading"
      :disk-space="diskSpace"
      :estimated-size="estimatedSize"
    />
  </div>
</template>

<style scoped>
/* Replaces the old readonly <input>: a boxed path row whose text opens the
 *  folder in the OS file manager. Only the path text is the click target. */
.path-open-wrap {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  margin-top: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}

/* Inherits .open-folder-link; matches the shared color/font, only caps width. */
.path-open {
  max-width: 100%;
}
</style>
