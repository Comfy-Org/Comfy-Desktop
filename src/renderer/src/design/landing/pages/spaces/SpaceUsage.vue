<script setup lang="ts">
import { computed } from 'vue'
import { Download } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Input from '../../ui/Input.vue'
import Meter from '../../ui/Meter.vue'
import Select from '../../ui/Select.vue'
import SettingsRow from '../../ui/SettingsRow.vue'
import SettingsSection from '../../ui/SettingsSection.vue'
import Switch from '../../ui/Switch.vue'
import PayerPicker from '../../parts/space/PayerPicker.vue'
import UsageBreakdown from '../../parts/space/UsageBreakdown.vue'
import { fmt } from '../../parts/env/env'
import { spaceById } from '../../spaces'
import { toast } from '../../useProto'

/** The studio pays Comfy; each space has seats, a budget and optional rebilling. */
const { spaceId } = defineProps<{ spaceId: string }>()
const space = computed(() => spaceById(spaceId)!)
const budget = computed({
  get: () => String(space.value.budget),
  set: (v: string) => (space.value.budget = Number(v.replace(/\D/g, '')) || space.value.budget)
})
const seats = computed(() => space.value.members.filter((m) => m.role !== 'viewer').length)
const viewers = computed(() => space.value.members.length - seats.value)
const included = 10
const billed = computed(() => Math.round(space.value.used * (1 + space.value.billing.markup / 100)))
</script>

<template>
  <div class="divide-y divide-border-default">
    <SettingsSection
      title="Who pays"
      description="Members sign in with a Comfy account either way. This decides whose credits each run uses."
    >
      <PayerPicker :space-id="spaceId" />
    </SettingsSection>
    <SettingsSection
      title="Spend"
      description="What this space used this month, by tool and by person."
    >
      <div class="flex items-end gap-6 px-5 py-5">
        <div class="flex-1">
          <p class="text-ui text-subtle-foreground">Total this month</p>
          <p class="mt-1 text-title font-semibold tabular-nums">
            {{ fmt(space.used) }}
            <span class="text-ui font-normal text-muted-foreground">credits</span>
          </p>
          <p class="mt-0.5 text-ui text-subtle-foreground">
            ≈ ${{ fmt(Math.round(space.used / 100)) }} ·
            {{ Math.round((space.used / space.budget) * 100) }}% of the
            {{ fmt(space.budget) }} budget
          </p>
        </div>
        <Meter :value="space.used" :max="space.budget" class="mb-2 w-40" />
      </div>
      <UsageBreakdown :space-id="spaceId" flat />
    </SettingsSection>
    <SettingsSection
      v-if="space.payer !== 'members'"
      title="Budget"
      description="Credits this space can use each month."
    >
      <SettingsRow
        label="Used this month"
        :hint="`${fmt(space.used)} of ${fmt(space.budget)}`"
        layout="inline"
      >
        <Meter :value="space.used" :max="space.budget" class="w-40" />
      </SettingsRow>
      <SettingsRow label="Monthly credits" layout="inline"
        ><Input v-model="budget" mono class="w-32"
      /></SettingsRow>
      <SettingsRow label="Alert me at" layout="inline">
        <Select
          v-model="space.billing.alertAt"
          class="w-32"
          :options="['50', '80', '90'].map((v) => ({ value: v, label: `${v}%` }))"
        />
      </SettingsRow>
      <div class="px-5 py-4">
        <Switch v-model="space.billing.hardStop" label="Pause runs when the budget runs out" />
      </div>
    </SettingsSection>
    <SettingsSection
      title="Seats"
      description="Members are paid seats. Viewers are free, so reviewers never cost you."
    >
      <SettingsRow
        label="Paid seats"
        :hint="`${seats} of ${included} included in Enterprise · then $15 / seat / month`"
        layout="inline"
      >
        <Meter :value="seats" :max="included" class="w-40" />
      </SettingsRow>
      <SettingsRow label="Free viewers" layout="inline">
        <span class="text-ui text-muted-foreground tabular-nums">{{ viewers }}</span>
      </SettingsRow>
    </SettingsSection>
    <SettingsSection
      :title="space.payer === 'owner' ? 'Rebilling' : 'Pricing'"
      :description="
        space.payer === 'owner'
          ? 'Turn this space\'s usage into an invoice.'
          : 'Members are charged the run cost plus your markup. Your share is paid out monthly.'
      "
    >
      <SettingsRow label="Markup" layout="inline">
        <Select
          :model-value="String(space.billing.markup)"
          class="w-32"
          :options="['0', '10', '15', '20', '25', '40'].map((v) => ({ value: v, label: `${v}%` }))"
          @update:model-value="(v: string) => (space.billing.markup = Number(v))"
        />
      </SettingsRow>
      <SettingsRow
        label="This month so far"
        :hint="`${fmt(space.used)} credits + ${space.billing.markup}%`"
        layout="inline"
      >
        <span class="text-heading font-semibold tabular-nums">{{ fmt(billed) }}</span>
      </SettingsRow>
      <div class="flex items-center gap-3 px-5 py-4">
        <Switch
          v-model="space.billing.invoice"
          label="Send a monthly usage report"
          class="flex-1"
        />
        <Button size="sm" @click="toast('Exported usage.csv')"><Download :size="13" />CSV</Button>
      </div>
    </SettingsSection>
  </div>
</template>
