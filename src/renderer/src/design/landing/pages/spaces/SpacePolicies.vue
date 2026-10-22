<script setup lang="ts">
import { computed } from 'vue'
import Input from '../../ui/Input.vue'
import Select from '../../ui/Select.vue'
import SettingsRow from '../../ui/SettingsRow.vue'
import SettingsSection from '../../ui/SettingsSection.vue'
import Switch from '../../ui/Switch.vue'
import { spaceById } from '../../spaces'

/** Guardrails for what goes in and what comes out of this space. */
const { spaceId } = defineProps<{ spaceId: string }>()
const p = computed(() => spaceById(spaceId)!.policies)
</script>

<template>
  <div class="divide-y divide-border-default">
    <SettingsSection title="Prompts and uploads" description="What people can put in.">
      <SettingsRow label="Content filter" layout="inline">
        <Select
          v-model="p.moderation"
          class="w-36"
          :options="[
            { value: 'standard', label: 'Standard' },
            { value: 'strict', label: 'Strict' }
          ]"
        />
      </SettingsRow>
      <SettingsRow label="Blocked terms" hint="Comma separated. Runs with these terms are stopped.">
        <Input v-model="p.blocklist" placeholder="competitor names, …" />
      </SettingsRow>
      <div class="px-5 py-4"><Switch v-model="p.uploads" label="Allow uploading images" /></div>
    </SettingsSection>
    <SettingsSection title="Outputs" description="What happens to results.">
      <div class="flex flex-col gap-3 px-5 py-4">
        <Switch v-model="p.approval" label="Review results before people can download them" />
        <Switch v-model="p.watermark" label="Watermark downloads" />
        <Switch v-model="p.downloads" label="Allow downloads" />
      </div>
      <SettingsRow label="Keep results for" layout="inline">
        <Select
          v-model="p.retention"
          class="w-36"
          :options="[
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            { value: '365', label: '1 year' }
          ]"
        />
      </SettingsRow>
    </SettingsSection>
    <SettingsSection title="Data" description="Fixed for every space.">
      <SettingsRow
        label="Shared with other spaces"
        hint="Inputs, outputs and models stay in this space."
        layout="inline"
      >
        <span class="text-ui text-muted-foreground">Never</span>
      </SettingsRow>
      <SettingsRow label="Used to train models" layout="inline">
        <span class="text-ui text-muted-foreground">Never</span>
      </SettingsRow>
    </SettingsSection>
  </div>
</template>
