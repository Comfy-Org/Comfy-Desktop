<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { DropdownMenuRadioGroup } from 'reka-ui'
import { Cloud, Laptop } from '@lucide/vue'
import BaseMenuRadioItem from '../../components/ui/BaseMenuRadioItem.vue'
import Tooltip from '../../components/ui/Tooltip.vue'
import { buildFailure } from '../../composables/useBuildProgress'
import { useProgressStore } from '../../stores/progressStore'
import { useSessionStore } from '../../stores/sessionStore'
import { isCloudBuild, type HomeBuildStatus } from './homeBuild'
import type { Installation } from '../../types/ipc'

const { builds, target, statusOf } = defineProps<{
  builds: readonly Installation[]
  target: Installation
  statusOf: (build: Installation) => HomeBuildStatus
}>()

const emit = defineEmits<{
  pick: [build: Installation]
}>()

const { t } = useI18n()

const sessionStore = useSessionStore()
const progressStore = useProgressStore()

function isLive(build: Installation): boolean {
  return statusOf(build) === 'running'
}

function problem(build: Installation): string | undefined {
  return buildFailure(build, sessionStore, progressStore, t)?.label
}
</script>

<template>
  <DropdownMenuRadioGroup :model-value="target.id">
    <Tooltip v-for="build in builds" :key="build.id" :text="problem(build)" side="left">
      <BaseMenuRadioItem
        as="button"
        type="button"
        :value="build.id"
        :disabled="build.statusTag?.style === 'danger'"
        :check="false"
        class="group ui-select-option w-full"
        data-testid="home-open-build-option"
        @select="emit('pick', build)"
      >
        <span class="relative flex shrink-0">
          <component :is="isCloudBuild(build) ? Cloud : Laptop" :size="14" aria-hidden="true" />
          <span
            v-if="problem(build) || isLive(build)"
            class="absolute -right-0.5 -bottom-0.5 size-2 rounded-full border-2 border-popover group-data-[state=checked]:border-[color-mix(in_srgb,var(--color-popover),white_6%)]"
            :class="problem(build) ? 'bg-destructive' : 'bg-[#59d38c]'"
            aria-hidden="true"
            data-testid="home-open-build-status-dot"
            :data-tone="problem(build) ? 'danger' : 'live'"
          />
        </span>
        <span class="min-w-0 flex-1 truncate text-left" :title="build.name">{{ build.name }}</span>
      </BaseMenuRadioItem>
    </Tooltip>
  </DropdownMenuRadioGroup>
</template>
