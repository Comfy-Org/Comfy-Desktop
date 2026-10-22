<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Input from '../../ui/Input.vue'
import LocationIcon from '../../ui/LocationIcon.vue'
import Select from '../../ui/Select.vue'
import SettingsRow from '../../ui/SettingsRow.vue'
import SettingsSection from '../../ui/SettingsSection.vue'
import MemberAvatar from '../../parts/MemberAvatar.vue'
import { instances, toast } from '../../useProto'
import { MEMBERS, thumb } from '../../mock'

const { name, envId } = defineProps<{ name: string; envId: string }>()
const emit = defineEmits<{ members: [] }>()

const title = ref(name)
const runsOn = ref(envId)
const access = ref<'restricted' | 'workspace'>('restricted')
const budget = ref('12,000')
const perMember = ref('2,000')

const runTargets = computed(() => instances.value.map((i) => ({ value: i.id, label: i.name })))
const runKind = computed(() => instances.value.find((i) => i.id === runsOn.value)?.kind ?? 'cloud')
const mosaic = [
  'image_z_image_turbo',
  'video_ltx2_5_i2v',
  'template_product_placement',
  'image_flux2'
]
</script>

<template>
  <div class="divide-y divide-border-default">
    <SettingsSection
      title="General"
      description="How the project shows up in your sidebar and across the workspace."
    >
      <SettingsRow label="Name">
        <Input v-model="title" size="lg" aria-label="Project name" />
      </SettingsRow>
      <SettingsRow label="Thumbnail" hint="Made from the latest outputs until you pick one.">
        <div class="flex items-center gap-4">
          <!-- Mosaic 8, inset 2 -> tiles 4 (min). -->
          <div
            class="grid size-18 shrink-0 grid-cols-2 gap-0.5 overflow-hidden rounded-control border border-border-default bg-black/30 p-0.5"
          >
            <img
              v-for="t in mosaic"
              :key="t"
              :src="thumb(t)"
              alt=""
              class="size-full rounded-min object-cover"
            />
          </div>
          <div class="flex gap-1.5">
            <Button size="sm" @click="toast('Upload thumbnail')">Upload</Button>
            <Button variant="ghost" size="sm" @click="toast('Reset to auto')">Use outputs</Button>
          </div>
        </div>
      </SettingsRow>
    </SettingsSection>

    <SettingsSection
      title="Build"
      description="Every workflow in this project runs here. Changing it moves the whole project."
    >
      <SettingsRow label="Runs on" layout="inline">
        <LocationIcon :kind="runKind" :size="16" />
        <Select
          v-model="runsOn"
          :options="runTargets"
          variant="ghost"
          class="pl-1.5 text-base-foreground"
        />
      </SettingsRow>
    </SettingsSection>

    <SettingsSection title="Access" description="Who can find and open this project.">
      <SettingsRow
        label="General access"
        :hint="access === 'restricted' ? 'Only invited people' : 'Everyone in the workspace'"
        layout="inline"
      >
        <Select
          v-model="access"
          variant="ghost"
          :options="[
            { value: 'restricted', label: 'Restricted' },
            { value: 'workspace', label: 'Workspace' }
          ]"
        />
      </SettingsRow>
      <SettingsRow label="People" :hint="`${MEMBERS.length} members`" layout="inline">
        <span class="mr-1 flex -space-x-1.5">
          <MemberAvatar
            v-for="m in MEMBERS"
            :key="m.id"
            :name="m.name"
            size="sm"
            class="ring-2 ring-card-background"
          />
        </span>
        <Button variant="ghost" size="sm" @click="emit('members')"
          >Manage<ChevronRight :size="13"
        /></Button>
      </SettingsRow>
    </SettingsSection>

    <SettingsSection
      title="Credits"
      description="Caps for this project. Billing stays with the workspace."
    >
      <div class="grid grid-cols-2 divide-x divide-border-default">
        <SettingsRow label="Monthly budget" hint="Runs stop at this amount.">
          <Input
            v-model="budget"
            size="lg"
            inputmode="numeric"
            aria-label="Monthly budget"
            class="[&_input]:tabular-nums"
          >
            <template #trailing
              ><span class="text-ui text-subtle-foreground">credits</span></template
            >
          </Input>
        </SettingsRow>
        <SettingsRow label="Limit per member" hint="Override it per person in Members.">
          <Input
            v-model="perMember"
            size="lg"
            inputmode="numeric"
            aria-label="Limit per member"
            class="[&_input]:tabular-nums"
          >
            <template #trailing
              ><span class="text-ui text-subtle-foreground">credits</span></template
            >
          </Input>
        </SettingsRow>
      </div>
    </SettingsSection>

    <SettingsSection
      title="Danger zone"
      description="Removes the project and its cloud workflows. Local workflow files on this computer stay."
      tone="danger"
    >
      <SettingsRow label="Delete this project" hint="This can't be undone." layout="inline">
        <Button variant="destructive" size="sm" @click="toast('Delete project…')"
          >Delete project</Button
        >
      </SettingsRow>
    </SettingsSection>
  </div>
</template>
