<script setup lang="ts">
import { ref } from 'vue'
import { Plus } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import Input from '../../ui/Input.vue'
import Meter from '../../ui/Meter.vue'
import PageHeader from '../../ui/PageHeader.vue'
import SettingsRow from '../../ui/SettingsRow.vue'
import SettingsSection from '../../ui/SettingsSection.vue'
import ProjectMembers from '../project/ProjectMembers.vue'
import ProjectUsage from '../project/ProjectUsage.vue'
import { proto, toast, workspace } from '../../useProto'
import { USER } from '../../mock'

/** Workspace admin: the same in Create and Build, reached from the
 *  workspace menu. Owners need it; most people never do. */
const monthly = ref('50,000')
const perMember = ref('2,000')
const PROVIDERS = [
  { name: 'OpenAI', key: 'sk-…4f2a', added: 'Aug 12' },
  { name: 'Google AI', key: 'AIza…91c', added: 'Sep 2' }
]
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <template v-if="proto.page === 'usage'">
      <PageHeader
        title="Usage"
        :description="`Credits across ${workspace.name}: ComfyUI sessions and API requests, by person.`"
      />
      <ProjectUsage />
    </template>

    <template v-else-if="proto.page === 'billing'">
      <PageHeader
        title="Billing & credits"
        :description="`${workspace.plan} · billed to ${workspace.name}.`"
      >
        <template #actions
          ><Button variant="primary" size="lg" @click="toast('Buy credits')"
            ><Plus :size="15" />Buy credits</Button
          ></template
        >
      </PageHeader>
      <div class="divide-y divide-border-default">
        <SettingsSection title="Credits" description="Shared by everyone in the workspace.">
          <SettingsRow label="Balance" layout="inline"
            ><span class="text-heading font-semibold tabular-nums">{{
              USER.credits
            }}</span></SettingsRow
          >
          <SettingsRow label="Used this month" hint="9,800 of 20,000 included" layout="inline"
            ><Meter :value="9800" :max="20000" class="w-40"
          /></SettingsRow>
        </SettingsSection>
        <SettingsSection title="Plan">
          <SettingsRow :label="workspace.plan" hint="Renews Nov 1" layout="inline"
            ><Button size="sm" @click="toast('Change plan')">Change plan</Button></SettingsRow
          >
          <SettingsRow label="Invoices" layout="inline"
            ><Button variant="ghost" size="sm" @click="toast('Invoices')"
              >View all</Button
            ></SettingsRow
          >
        </SettingsSection>
      </div>
    </template>

    <template v-else-if="proto.page === 'limits'">
      <PageHeader
        title="Limits"
        description="Caps that stop runs and API requests before they surprise you."
      />
      <div class="divide-y divide-border-default">
        <SettingsSection
          title="Workspace"
          description="Applies to ComfyUI sessions and deployments together."
        >
          <SettingsRow label="Monthly budget" hint="Everything pauses at this amount.">
            <Input v-model="monthly" size="lg" inputmode="numeric" aria-label="Monthly budget"
              ><template #trailing
                ><span class="text-ui text-subtle-foreground">credits</span></template
              ></Input
            >
          </SettingsRow>
          <SettingsRow label="Per person" hint="Default for each member. Override it in People.">
            <Input v-model="perMember" size="lg" inputmode="numeric" aria-label="Per person limit"
              ><template #trailing
                ><span class="text-ui text-subtle-foreground">credits</span></template
              ></Input
            >
          </SettingsRow>
        </SettingsSection>
      </div>
    </template>

    <template v-else-if="proto.page === 'people'">
      <PageHeader
        title="People"
        :description="`Who's in ${workspace.name} and what they can do.`"
      />
      <ProjectMembers />
    </template>

    <template v-else>
      <PageHeader
        title="Provider keys"
        description="Bring your own keys for partner models. Calls through the Models API use them instead of credits."
      >
        <template #actions
          ><Button variant="primary" size="lg" @click="toast('Add provider key')"
            ><Plus :size="15" />Add key</Button
          ></template
        >
      </PageHeader>
      <Card class="overflow-hidden">
        <div
          v-for="p in PROVIDERS"
          :key="p.name"
          class="grid min-h-12 grid-cols-[minmax(0,1fr)_200px_120px] items-center gap-4 border-b border-border-default px-5 last:border-b-0"
        >
          <span>{{ p.name }}</span
          ><code class="font-mono text-ui text-muted-foreground">{{ p.key }}</code
          ><span class="text-ui text-subtle-foreground">{{ p.added }}</span>
        </div>
      </Card>
    </template>
  </div>
</template>
