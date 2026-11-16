<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, Folder, FolderOpen } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import Skeleton from '@comfyorg/design-system/skeleton/Skeleton'
import Tooltip from '../components/ui/Tooltip.vue'
import FolderActionsMenu from './FolderActionsMenu.vue'
import type { OutputFolder, OutputSubfolder } from '../types/ipc'

const SHOWN_BUILD_NAMES = 2
const WINDOWS_PATH = /^([A-Za-z]:|\\\\)/
const DRIVE_ONLY = /^[A-Za-z]:$/
const NETWORK_PATH = /^\\\\/

const { folders, failed, trail, subfolders } = defineProps<{
  folders: OutputFolder[] | null
  failed: boolean
  trail: string[]
  subfolders: OutputSubfolder[]
}>()

const emit = defineEmits<{
  enter: [folderPath: string]
  go: [depth: number]
}>()

const { t } = useI18n()
const idPrefix = useId()

const current = computed(() => trail.at(-1) ?? null)
const crumbs = computed(() => [t('assets.thisComputer'), ...trail.map(folderName)])

function pathParts(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean)
}

function folderName(path: string): string {
  return pathParts(path).at(-1) ?? path
}

function shortParentPath(path: string): string {
  const separator = WINDOWS_PATH.test(path) ? '\\' : '/'
  const root = path.match(/^[\\/]+/)?.[0] ?? ''
  const parents = pathParts(path).slice(0, -1)
  const kept = NETWORK_PATH.test(path) ? 2 : 1
  const shown =
    parents.length <= kept + 1 ? parents : [...parents.slice(0, kept), '…', parents.at(-1)]
  const joined = root + shown.join(separator)
  return DRIVE_ONLY.test(joined) ? joined + separator : joined
}

function shownBuildNames(output: OutputFolder): string {
  return output.builds.length > 0
    ? output.builds.slice(0, SHOWN_BUILD_NAMES).join(', ')
    : t('assets.local.noBuilds')
}

function allBuildNames(output: OutputFolder): string {
  return output.builds.length > 0 ? output.builds.join(', ') : t('assets.local.noBuilds')
}

function hiddenBuildCount(output: OutputFolder): number {
  return Math.max(0, output.builds.length - SHOWN_BUILD_NAMES)
}

function openFolder(path: string): void {
  void window.api.openPath(path)
}
</script>

<template>
  <div
    class="mx-auto flex w-full max-w-300 flex-col gap-5 px-10 pt-2"
    :class="!current && 'pb-24'"
    data-testid="local-folders"
  >
    <template v-if="current">
      <div class="flex min-h-8 items-center gap-3">
        <nav
          class="flex min-w-0 flex-wrap items-center gap-1 text-ui"
          :aria-label="t('assets.local.path')"
        >
          <template v-for="(crumb, depth) in crumbs" :key="depth">
            <ChevronRight
              v-if="depth > 0"
              :size="14"
              class="shrink-0 text-subtle-foreground"
              aria-hidden="true"
            />
            <span
              v-if="depth === trail.length"
              class="truncate text-foreground"
              aria-current="page"
            >
              {{ crumb }}
            </span>
            <button
              v-else
              type="button"
              class="cursor-pointer truncate rounded-md text-muted-foreground hover:text-foreground"
              :data-testid="`local-crumb-${depth}`"
              @click="emit('go', depth)"
            >
              {{ crumb }}
            </button>
          </template>
        </nav>
        <Button
          type="button"
          variant="secondary"
          size="md"
          class="ml-auto shrink-0 gap-1.5 px-3 text-ui"
          :title="current"
          data-testid="local-open-folder"
          @click="openFolder(current)"
        >
          <FolderOpen :size="15" aria-hidden="true" />
          {{ t('assets.local.openFolder') }}
        </Button>
      </div>

      <ul
        v-if="subfolders.length > 0"
        class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 p-0"
      >
        <li
          v-for="entry in subfolders"
          :key="entry.path"
          class="relative flex h-10 items-center gap-2.5 rounded-lg bg-card pr-1 pl-3 transition-colors duration-150 hover:bg-card-hover"
        >
          <Folder :size="16" class="shrink-0 text-muted-foreground" aria-hidden="true" />
          <button
            type="button"
            class="min-w-0 flex-1 cursor-pointer truncate text-left text-ui text-foreground after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
            :data-testid="`local-subfolder-${entry.name}`"
            @click="emit('enter', entry.path)"
          >
            {{ entry.name }}
          </button>
          <FolderActionsMenu
            :path="entry.path"
            :trigger-test-id="`local-subfolder-menu-${entry.name}`"
          />
        </li>
      </ul>
    </template>

    <ul
      v-else-if="folders === null && !failed"
      class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-4 gap-y-6 p-0"
      role="status"
      :aria-label="t('common.loading')"
      data-testid="local-folders-loading"
    >
      <li v-for="n in 2" :key="n" class="flex flex-col gap-2">
        <Skeleton class="h-6 w-32 rounded-md" />
        <Skeleton class="h-14 w-full rounded-xl" />
      </li>
    </ul>

    <section
      v-else-if="failed || !folders?.length"
      class="flex flex-col items-center gap-1.5 px-6 py-16 text-center"
      data-testid="local-folders-empty"
    >
      <h2 class="m-0 text-heading font-semibold text-foreground">
        {{ failed ? t('assets.loadFailed') : t('assets.local.noFoldersTitle') }}
      </h2>
      <p v-if="!failed" class="m-0 text-ui text-muted-foreground">
        {{ t('assets.local.noFoldersBody') }}
      </p>
    </section>

    <ul
      v-else
      class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-4 gap-y-6 p-0"
    >
      <li v-for="(output, index) in folders" :key="output.path" class="flex min-w-0 flex-col gap-2">
        <div class="flex h-6 min-w-0">
          <Tooltip
            side="top"
            align="start"
            keep-open-on-click
            :disabled="output.builds.length === 0"
            class="min-w-0 items-center gap-1.5"
            :data-testid="`local-folder-heading-${output.path}`"
          >
            <h2
              :class="[
                'm-0 truncate text-ui',
                output.builds.length > 0 ? 'font-medium text-foreground' : 'text-muted-foreground'
              ]"
            >
              {{ shownBuildNames(output) }}
            </h2>
            <Button
              v-if="hiddenBuildCount(output) > 0"
              type="button"
              variant="secondary"
              size="sm"
              class="shrink-0"
              :aria-describedby="`${idPrefix}-builds-${index}`"
              :data-testid="`local-folder-more-${output.path}`"
            >
              +{{ hiddenBuildCount(output) }}
            </Button>
            <template #content>
              <span class="mb-0.5 block">{{ t('assets.local.savedBy') }}</span>
              <span v-for="name in output.builds" :key="name" class="block">{{ name }}</span>
            </template>
          </Tooltip>
          <span :id="`${idPrefix}-builds-${index}`" class="sr-only">{{
            allBuildNames(output)
          }}</span>
        </div>
        <div
          class="relative flex h-14 items-center gap-3 rounded-xl bg-card pr-1.5 pl-4 transition-colors duration-150 hover:bg-card-hover"
        >
          <Folder :size="20" class="shrink-0 text-muted-foreground" aria-hidden="true" />
          <button
            type="button"
            class="flex min-w-0 flex-1 cursor-pointer flex-col text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
            :aria-describedby="`${idPrefix}-builds-${index}`"
            :title="output.path"
            :data-testid="`local-folder-${output.path}`"
            @click="emit('enter', output.path)"
          >
            <span class="truncate text-ui font-medium text-foreground">{{
              folderName(output.path)
            }}</span>
            <span class="truncate text-ui text-subtle-foreground">{{
              shortParentPath(output.path)
            }}</span>
          </button>
          <FolderActionsMenu
            :path="output.path"
            :trigger-test-id="`local-folder-menu-${output.path}`"
          />
        </div>
      </li>
    </ul>
  </div>
</template>
