<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Download, Folder, Plus } from 'lucide-vue-next'
import Button from '../ui/Button.vue'
import Card from '../ui/Card.vue'
import Input from '../ui/Input.vue'
import Meter from '../ui/Meter.vue'
import PageHeader from '../ui/PageHeader.vue'
import Select from '../ui/Select.vue'
import SettingsRow from '../ui/SettingsRow.vue'
import SettingsSection from '../ui/SettingsSection.vue'
import Sparkline from '../ui/Sparkline.vue'
import Switch from '../ui/Switch.vue'
import Tabs from '../ui/Tabs.vue'
import InstanceGlyph from '../parts/InstanceGlyph.vue'
import MemberAvatar from '../parts/MemberAvatar.vue'
import StatTile from '../parts/env/StatTile.vue'
import { envById, fmt } from '../parts/env/env'
import { allWorkflows } from '../gallery'
import { go, toast, workspace } from '../useProto'
import { MEMBERS, PROJECTS } from '../mock'

/** Admin view of every project: what's happening, and what it costs. */
const tab = ref<'projects' | 'billing'>('projects')

// Mock per-project numbers, stable per id.
const seed = (id: string): number => [...id].reduce((n, c) => n + c.charCodeAt(0), 0)
const rows = reactive(
  PROJECTS.map((p) => {
    const s = seed(p.id)
    return {
      ...p,
      spend: 2000 + ((s * 137) % 18000),
      budget: [10000, 15000, 20000, 25000][s % 4]!,
      members: MEMBERS.slice(0, 1 + (s % Math.max(1, MEMBERS.length))),
      runs: 40 + ((s * 7) % 600),
      trend: Array.from({ length: 12 }, (_, i) => 20 + ((s * (i + 3)) % 50)),
      hardStop: s % 2 === 0,
      active: ['12 min ago', '1 hour ago', 'Yesterday', '3 days ago', 'Last week'][s % 5]!
    }
  })
)
const workflowsIn = (name: string): number =>
  allWorkflows.value.filter((w) => w.project === name).length
const usd = (credits: number): string => `$${fmt(Math.round(credits / 100))}`
const total = computed(() => rows.reduce((n, r) => n + r.spend, 0))
const near = computed(() => rows.filter((r) => r.spend / r.budget >= 0.8))

// Workspace-wide spend controls.
const controls = reactive({
  cap: '120000',
  defaultBudget: '15000',
  alertAt: '80',
  approveGpu: true,
  partnerModels: true
})
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader
      title="All projects"
      :description="`Every project in ${workspace.name}: activity, people and spend.`"
    >
      <template #actions
        ><Button variant="primary" size="lg" @click="toast('New project - pick its build')"
          ><Plus :size="15" />New project</Button
        ></template
      >
    </PageHeader>

    <Card class="grid grid-cols-4 divide-x divide-border-default">
      <StatTile
        label="Projects"
        :value="String(rows.length)"
        :hint="`${rows.reduce((n, r) => n + r.runs, 0)} runs this month`"
      />
      <StatTile label="Spend · this month" :value="usd(total)" :hint="`${fmt(total)} credits`" />
      <StatTile
        label="Workspace cap"
        :value="`${Math.round((total / Number(controls.cap)) * 100)}%`"
        :hint="`of ${fmt(Number(controls.cap))} credits`"
      >
        <Meter :value="total" :max="Number(controls.cap)" class="mb-2 w-20" />
      </StatTile>
      <StatTile
        label="Near budget"
        :value="String(near.length)"
        :hint="near.map((r) => r.name).join(', ') || 'All within budget'"
      />
    </Card>

    <Tabs
      v-model="tab"
      class="mt-8"
      :options="[
        { value: 'projects', label: 'Projects', count: rows.length },
        { value: 'billing', label: 'Billing & spend controls' }
      ]"
    >
      <!-- Overview -->
      <Card v-if="tab === 'projects'" class="mt-8 overflow-hidden">
        <div
          class="grid h-10 grid-cols-[minmax(0,1fr)_170px_110px_100px_120px_120px] items-center gap-4 border-b border-border-default px-5 text-ui text-subtle-foreground"
        >
          <span>Project</span><span>Runs on</span><span>People</span
          ><span class="text-right">Workflows</span><span>Activity</span><span>Last active</span>
        </div>
        <button
          v-for="r in rows"
          :key="r.id"
          type="button"
          class="grid min-h-15 w-full grid-cols-[minmax(0,1fr)_170px_110px_100px_120px_120px] items-center gap-4 border-b border-border-default px-5 text-left outline-none last:border-b-0 hover:bg-secondary-background/50 focus-visible:bg-secondary-background"
          @click="go(`project:${r.id}`)"
        >
          <span class="flex min-w-0 items-center gap-3">
            <Folder :size="16" class="shrink-0 text-muted-foreground" />
            <span class="truncate text-ui font-medium">{{ r.name }}</span>
          </span>
          <span class="flex min-w-0 items-center gap-2 text-ui text-muted-foreground">
            <InstanceGlyph v-if="envById(r.envId)" :inst="envById(r.envId)!" size="xs" />
            <span class="truncate">{{ envById(r.envId)?.name ?? '—' }}</span>
          </span>
          <span class="flex -space-x-1.5">
            <MemberAvatar
              v-for="m in r.members.slice(0, 4)"
              :key="m.id"
              :name="m.name"
              size="sm"
              class="ring-2 ring-card-background"
            />
          </span>
          <span class="text-right text-ui text-muted-foreground tabular-nums">{{
            workflowsIn(r.name)
          }}</span>
          <Sparkline :values="r.trend" :width="96" :height="20" />
          <span class="text-ui text-subtle-foreground">{{ r.active }}</span>
        </button>
      </Card>

      <!-- Billing and spend controls -->
      <div v-else class="divide-y divide-border-default">
        <SettingsSection
          title="By project"
          description="Spend against each project's monthly budget."
        >
          <div
            class="grid h-10 grid-cols-[minmax(0,1fr)_150px_80px_110px_60px] items-center gap-4 px-5 text-ui text-subtle-foreground"
          >
            <span>Project</span><span>Budget used</span><span class="text-right">Spend</span
            ><span>Budget</span><span class="text-right">Stop</span>
          </div>
          <div
            v-for="r in rows"
            :key="r.id"
            class="grid min-h-13 grid-cols-[minmax(0,1fr)_150px_80px_110px_60px] items-center gap-4 px-5"
          >
            <span class="truncate text-ui">{{ r.name }}</span>
            <span class="flex items-center gap-2">
              <Meter :value="r.spend" :max="r.budget" class="flex-1" />
              <span class="w-8 text-right text-ui text-subtle-foreground tabular-nums"
                >{{ Math.round((r.spend / r.budget) * 100) }}%</span
              >
            </span>
            <span class="text-right text-ui tabular-nums">{{ usd(r.spend) }}</span>
            <Select
              :model-value="String(r.budget)"
              size="sm"
              :options="
                ['5000', '10000', '15000', '20000', '25000', '50000'].map((v) => ({
                  value: v,
                  label: fmt(Number(v))
                }))
              "
              @update:model-value="(v: string) => (r.budget = Number(v))"
            />
            <span class="flex justify-end"
              ><Switch v-model="r.hardStop" label="" :aria-label="`Pause ${r.name} at budget`"
            /></span>
          </div>
          <div class="flex justify-end px-5 py-3">
            <Button size="sm" variant="ghost" @click="toast('Exported project-spend.csv')"
              ><Download :size="13" />Export CSV</Button
            >
          </div>
        </SettingsSection>

        <SettingsSection title="Spend controls" description="Guardrails for the whole workspace.">
          <SettingsRow
            label="Monthly workspace cap"
            hint="All projects together. Runs pause when it's reached."
          >
            <Input v-model="controls.cap" mono
              ><template #trailing
                ><span class="text-ui text-subtle-foreground">credits</span></template
              ></Input
            >
          </SettingsRow>
          <SettingsRow label="Default budget for new projects" layout="inline">
            <Input v-model="controls.defaultBudget" mono class="w-32" />
          </SettingsRow>
          <SettingsRow label="Alert project owners at" layout="inline">
            <Select
              v-model="controls.alertAt"
              class="w-32"
              :options="['50', '80', '90'].map((v) => ({ value: v, label: `${v}%` }))"
            />
          </SettingsRow>
          <div class="flex flex-col gap-3 px-5 py-4">
            <Switch
              v-model="controls.approveGpu"
              label="Ask an admin before using dedicated GPUs"
            />
            <Switch
              v-model="controls.partnerModels"
              label="Allow partner models (OpenAI, Kling, …)"
            />
          </div>
        </SettingsSection>

        <SettingsSection
          title="Billing"
          :description="`${workspace.plan} · billed to ${workspace.name}.`"
        >
          <SettingsRow label="Payment method" hint="Visa ending 4242" layout="inline">
            <Button size="sm" @click="go('billing')">Manage</Button>
          </SettingsRow>
          <SettingsRow label="Invoices" hint="Split by project on every invoice" layout="inline">
            <Button size="sm" @click="toast('Opening invoices')">View</Button>
          </SettingsRow>
        </SettingsSection>
      </div>
    </Tabs>
  </div>
</template>
