<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocalStorage } from '@vueuse/core'
import { ChartColumn, Gauge, Server } from 'lucide-vue-next'
import type { Component } from 'vue'
import Button from '@comfyorg/design-system/button/Button'
import ComfyCLogo from '../components/icons/ComfyCLogo.vue'
import ComfyWordmark from '../components/icons/ComfyWordmark.vue'
import SidebarAccount from './SidebarAccount.vue'
import SidebarToggleIcon from './SidebarToggleIcon.vue'
import type { DashboardPage } from '../types/ipc'

const { activePage } = defineProps<{
  activePage: DashboardPage
}>()

const emit = defineEmits<{
  navigate: [page: DashboardPage]
}>()

interface SidebarRow {
  page: DashboardPage
  label: string
  icon: Component
}

const { t } = useI18n()

const collapsed = useLocalStorage('comfy.desktop.sidebar.collapsed', false)
const toggleLabel = computed(() => (collapsed.value ? t('sidebar.expand') : t('sidebar.collapse')))

const mainRows = computed<SidebarRow[]>(() => [
  { page: 'chooser', label: t('sidebar.builds'), icon: Server }
])
const toolRows = computed<SidebarRow[]>(() => [
  { page: 'performance-test', label: t('fileMenu.performanceTest'), icon: Gauge },
  { page: 'benchmarks', label: t('fileMenu.benchmarks'), icon: ChartColumn }
])
const groups = computed(() => [
  { key: 'main', rows: mainRows.value },
  { key: 'tools', title: t('sidebar.tools'), rows: toolRows.value }
])

function navigate(page: DashboardPage): void {
  emit('navigate', page)
  window.api.navigatePanel(page)
}
</script>

<template>
  <aside
    class="app-sidebar flex shrink-0 flex-col overflow-hidden rounded-shell bg-sidebar-background transition-[width] duration-240 ease-in-out motion-reduce:transition-none"
    :class="collapsed ? 'w-[72px] items-center px-3 py-2' : 'w-[244px] px-3 py-2'"
    :aria-label="t('sidebar.navigation')"
    data-testid="app-sidebar"
    :data-collapsed="collapsed"
  >
    <div
      class="flex shrink-0 items-center"
      :class="
        collapsed ? 'mt-2.5 mb-3.5 flex-col gap-3' : 'mt-2 mb-3.5 h-9 w-full justify-between pl-1.5'
      "
    >
      <Button
        variant="textonly"
        size="unset"
        class="h-auto rounded-[7px] p-0.5 text-foreground hover:bg-transparent"
        :aria-label="t('sidebar.home')"
        :title="t('sidebar.home')"
        @click="navigate('chooser')"
      >
        <ComfyCLogo v-if="collapsed" :size="20" />
        <ComfyWordmark v-else class="h-[22px] w-auto" />
      </Button>
      <Button
        variant="muted-textonly"
        size="unset"
        class="group size-[30px] rounded-[7px] p-0 hover:bg-secondary hover:text-foreground"
        data-testid="app-sidebar-toggle"
        :aria-label="toggleLabel"
        :aria-expanded="!collapsed"
        :title="toggleLabel"
        @click="collapsed = !collapsed"
      >
        <SidebarToggleIcon />
      </Button>
    </div>

    <nav
      class="flex min-h-0 w-full flex-1 scrollbar-hide flex-col gap-px overflow-x-hidden overflow-y-auto"
    >
      <template v-for="group in groups" :key="group.key">
        <template v-if="group.title">
          <div v-if="collapsed" class="mx-2.5 my-3 h-px shrink-0 bg-accent" role="separator" />
          <div
            v-else
            class="mt-5.5 flex h-6.5 shrink-0 items-center px-3 text-[13px]/5 font-medium tracking-[0.65px] text-subtle-foreground uppercase"
          >
            {{ group.title }}
          </div>
        </template>
        <Button
          v-for="row in group.rows"
          :key="row.page"
          variant="muted-textonly"
          size="unset"
          class="h-8 w-full shrink-0 rounded-lg text-[13px]/5 font-normal hover:bg-secondary hover:text-foreground"
          :class="[
            collapsed ? 'justify-center px-0' : 'justify-start gap-2.5 px-3',
            row.page === activePage && 'bg-accent text-foreground hover:bg-accent'
          ]"
          :aria-current="row.page === activePage ? 'page' : undefined"
          :aria-label="row.label"
          :title="collapsed ? row.label : undefined"
          :data-testid="`app-sidebar-${row.page}`"
          @click="navigate(row.page)"
        >
          <component :is="row.icon" :size="15" aria-hidden="true" />
          <span v-if="!collapsed" class="min-w-0 flex-1 truncate text-left">{{ row.label }}</span>
        </Button>
      </template>
    </nav>

    <SidebarAccount class="mt-2 w-full shrink-0" :collapsed="collapsed" />
  </aside>
</template>
