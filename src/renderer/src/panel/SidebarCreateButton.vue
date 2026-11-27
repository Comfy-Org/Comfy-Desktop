<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, LoaderCircle, Plus } from '@lucide/vue'
import Button from '@comfyorg/design-system/button/Button'
import ButtonGroup from '@comfyorg/design-system/button-group/ButtonGroup'
import Menu from '@comfyorg/design-system/menu/Menu'
import Tooltip from '../components/ui/Tooltip.vue'
import OpenBuildMenuItems from './home/OpenBuildMenuItems.vue'
import { useOpenComfyUI } from './home/useOpenComfyUI'
import type { Installation } from '../types/ipc'

const { collapsed } = defineProps<{ collapsed: boolean }>()

const RAIL_BUTTON_CLASS = 'size-8 rounded-control p-0 data-[state=open]:bg-foreground/80'

const emit = defineEmits<{
  open: [build: Installation]
}>()

const { t } = useI18n()

const { openableBuilds, openTarget, statusOf, openBuild, pickAndOpen } = useOpenComfyUI((build) =>
  emit('open', build)
)

const menuOpen = ref(false)
const targetStarting = computed(
  () => !!openTarget.value && statusOf(openTarget.value) === 'starting'
)
const offersBuildMenu = computed(() => openableBuilds.value.length > 1)
const description = computed(() => {
  if (!openTarget.value) return undefined
  return targetStarting.value
    ? t('home.opensWhenReady')
    : t('home.opensIn', { name: openTarget.value.name })
})

function create(): void {
  if (openTarget.value) openBuild(openTarget.value)
}

function closeMenu(): void {
  menuOpen.value = false
}
onMounted(() => window.addEventListener('blur', closeMenu))
onBeforeUnmount(() => window.removeEventListener('blur', closeMenu))
</script>

<template>
  <template v-if="openTarget">
    <Tooltip
      v-if="collapsed"
      :text="menuOpen ? undefined : t('sidebar.create')"
      side="right"
      class="mb-3 ml-1 shrink-0 self-start"
    >
      <Menu
        v-if="offersBuildMenu"
        v-model:open="menuOpen"
        :modal="false"
        align="start"
        side="right"
        :side-offset="8"
        class="z-[9999] min-w-48 max-w-80"
        :aria-label="t('home.chooseBuildToOpen')"
      >
        <template #trigger>
          <Button
            type="button"
            variant="inverted"
            size="unset"
            :class="RAIL_BUTTON_CLASS"
            :aria-label="t('sidebar.create')"
            :aria-description="description"
            data-testid="sidebar-create"
            :data-build-id="openTarget.id"
          >
            <Plus :size="16" aria-hidden="true" />
          </Button>
        </template>
        <OpenBuildMenuItems
          :builds="openableBuilds"
          :target="openTarget"
          :status-of="statusOf"
          @pick="pickAndOpen"
        />
      </Menu>
      <Button
        v-else
        type="button"
        variant="inverted"
        size="unset"
        :class="RAIL_BUTTON_CLASS"
        :aria-label="t('sidebar.create')"
        :aria-description="description"
        data-testid="sidebar-create"
        :data-build-id="openTarget.id"
        @click="create"
      >
        <Plus :size="16" aria-hidden="true" />
      </Button>
    </Tooltip>
    <ButtonGroup
      v-else
      class="mb-3 flex w-full shrink-0 rounded-control"
      data-testid="sidebar-create-group"
    >
      <div class="flex min-w-0 flex-1">
        <Button
          type="button"
          variant="inverted"
          size="unset"
          class="h-8 w-full gap-1.5 px-3 text-[13px]/5 font-medium"
          :class="offersBuildMenu ? 'justify-start rounded-none' : 'rounded-control'"
          :aria-label="t('sidebar.create')"
          :aria-description="description"
          data-testid="sidebar-create"
          :data-build-id="openTarget.id"
          @click="create"
        >
          <LoaderCircle
            v-if="targetStarting"
            :size="14"
            class="shrink-0 animate-spin [animation-duration:900ms] motion-reduce:animate-none"
            aria-hidden="true"
            data-testid="sidebar-create-spinner"
          />
          <Plus v-else :size="14" class="shrink-0" aria-hidden="true" />
          <span>{{ t('sidebar.create') }}</span>
        </Button>
      </div>
      <Menu
        v-if="offersBuildMenu"
        v-model:open="menuOpen"
        :modal="false"
        align="start"
        side="right"
        :side-offset="8"
        class="z-[9999] min-w-48 max-w-80"
        :aria-label="t('home.chooseBuildToOpen')"
      >
        <template #trigger>
          <Button
            type="button"
            variant="inverted"
            size="unset"
            class="h-8 w-[30px] shrink-0 rounded-none border-l border-solid border-background/18 p-0 data-[state=open]:bg-foreground/80"
            :aria-label="t('home.chooseBuildToOpen')"
            data-testid="sidebar-create-menu"
          >
            <ChevronDown :size="14" aria-hidden="true" />
          </Button>
        </template>
        <OpenBuildMenuItems
          :builds="openableBuilds"
          :target="openTarget"
          :status-of="statusOf"
          @pick="pickAndOpen"
        />
      </Menu>
    </ButtonGroup>
  </template>
</template>
