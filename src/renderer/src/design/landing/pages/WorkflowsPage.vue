<script setup lang="ts">
import { computed, ref } from 'vue'
import { Images, Plus } from 'lucide-vue-next'
import Button from '../ui/Button.vue'
import PageHeader from '../ui/PageHeader.vue'
import Tabs from '../ui/Tabs.vue'
import InstanceGlyph from '../parts/InstanceGlyph.vue'
import MemberAvatar from '../parts/MemberAvatar.vue'
import { envById, envStatus } from '../parts/env/env'
import ProjectMembers from './project/ProjectMembers.vue'
import ProjectSettings from './project/ProjectSettings.vue'
import ProjectUsage from './project/ProjectUsage.vue'
import ProjectWorkflows from './project/ProjectWorkflows.vue'
import { go, toast } from '../useProto'
import { MEMBERS, PROJECTS } from '../mock'

/**
 * A project: a shared space that always runs on one environment. Every
 * workflow is created inside a project, so it's bound to that environment.
 */
const { project } = defineProps<{ project: string }>()

const p = computed(() => PROJECTS.find((x) => x.id === project))
const env = computed(() => (p.value ? envById(p.value.envId) : undefined))
type Tab = 'workflows' | 'usage' | 'settings' | 'members'
const tab = ref<Tab>('workflows')
const tabs = [
  { value: 'workflows' as Tab, label: 'Workflows' },
  { value: 'usage' as Tab, label: 'Usage' },
  { value: 'settings' as Tab, label: 'Settings' },
  { value: 'members' as Tab, label: 'Members' }
]
const extra = computed(() => MEMBERS.length - 3)
</script>

<template>
  <div v-if="p" class="mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader :title="p.name">
      <template #meta>
        <!-- The environment this project runs on -->
        <button
          v-if="env"
          type="button"
          class="inline-flex h-7 items-center gap-1.5 rounded-full border border-border-strong px-2.5 text-ui text-base-foreground outline-none hover:bg-secondary-background focus-visible:ring-2 focus-visible:ring-border-focus"
          :title="`Runs on ${env.name} · ${envStatus(env).label}`"
          @click="go(`environment:${env.id}`)"
        >
          <InstanceGlyph
            :inst="env"
            size="xs"
            dot
            class="[--glyph-ring:var(--color-card-background)]"
          />
          <span class="text-subtle-foreground">Runs on</span>{{ env.name }}
        </button>
      </template>
      <template #actions>
        <Button size="lg" class="gap-2 pl-2" @click="tab = 'members'">
          <span class="flex -space-x-1.5">
            <MemberAvatar
              v-for="m in MEMBERS.slice(0, 3)"
              :key="m.id"
              :name="m.name"
              size="sm"
              class="ring-2 ring-card-background-hover"
            />
            <span
              v-if="extra > 0"
              class="inline-flex size-5 items-center justify-center rounded-full bg-secondary-background-hover text-[9px] text-muted-foreground ring-2 ring-card-background-hover"
              >+{{ extra }}</span
            >
          </span>
          Share
        </Button>
        <Button size="lg" @click="go('assets')"><Images :size="15" />Media assets</Button>
        <Button
          variant="primary"
          size="lg"
          @click="toast(`New workflow in ${p.name} · runs on ${env?.name}`)"
          ><Plus :size="15" />Workflow</Button
        >
      </template>
    </PageHeader>

    <Tabs v-model="tab" :options="tabs">
      <ProjectWorkflows v-if="tab === 'workflows'" :project-name="p.name" :scope="env" />
      <ProjectUsage v-else-if="tab === 'usage'" />
      <ProjectSettings
        v-else-if="tab === 'settings'"
        :name="p.name"
        :env-id="p.envId"
        @members="tab = 'members'"
      />
      <ProjectMembers v-else />
    </Tabs>
  </div>
</template>
