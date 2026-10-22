<script setup lang="ts">
import { ref } from 'vue'
import { Plus } from 'lucide-vue-next'
import Badge from '../../landing/ui/Badge.vue'
import Button from '../../landing/ui/Button.vue'
import Card from '../../landing/ui/Card.vue'
import Input from '../../landing/ui/Input.vue'
import PageHeader from '../../landing/ui/PageHeader.vue'
import SectionHeader from '../../landing/ui/SectionHeader.vue'
import Select from '../../landing/ui/Select.vue'
import SettingsRow from '../../landing/ui/SettingsRow.vue'
import SettingsSection from '../../landing/ui/SettingsSection.vue'
import Switch from '../../landing/ui/Switch.vue'
import GallerySection from '../parts/GallerySection.vue'
import { toast } from '../../landing/useProto'

const name = ref('Nike')
const region = ref('eu')
const warm = ref(false)
</script>

<template>
  <GallerySection
    id="headers"
    :components="['PageHeader', 'SectionHeader']"
    title="Headers"
    description="Page header for top-level pages; section header for rows inside a page."
  >
    <Card variant="inset" padding="md">
      <PageHeader
        title="Workflows"
        description="Every workflow, on this computer and in the cloud."
      >
        <template #meta><Badge size="md">12</Badge></template>
        <template #actions
          ><Button variant="primary"><Plus :size="14" />Workflow</Button></template
        >
      </PageHeader>
    </Card>
    <Card variant="inset" padding="md">
      <SectionHeader title="Recently opened" link="See all" @link="toast('See all')" />
    </Card>
  </GallerySection>

  <GallerySection
    id="settings"
    :components="['SettingsSection', 'SettingsRow']"
    title="Settings"
    description="Two columns: what it is on the left, controls in a card on the right."
  >
    <div class="divide-y divide-border-default">
      <SettingsSection title="General" description="Shown to everyone in the space.">
        <SettingsRow label="Name"><Input v-model="name" /></SettingsRow>
        <SettingsRow label="Region" hint="Set when the space is created." layout="inline">
          <Select
            v-model="region"
            class="w-40"
            :options="[
              { value: 'eu', label: 'EU · Frankfurt' },
              { value: 'us', label: 'US · Virginia' }
            ]"
          />
        </SettingsRow>
        <div class="px-5 py-4"><Switch v-model="warm" label="Keep warm" /></div>
      </SettingsSection>
      <SettingsSection title="Danger zone" tone="danger">
        <SettingsRow
          label="Delete space"
          hint="Removes people, outputs and history."
          layout="inline"
        >
          <Button variant="destructive" size="sm">Delete</Button>
        </SettingsRow>
      </SettingsSection>
    </div>
  </GallerySection>
</template>
