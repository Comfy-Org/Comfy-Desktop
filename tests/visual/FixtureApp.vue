<script setup lang="ts">
import { ref } from 'vue'
import { Search, X } from 'lucide-vue-next'
import Button from '@comfyorg/design-system/button/Button'
import Checkbox from '@comfyorg/design-system/checkbox/Checkbox'
import BaseInput from '../../src/renderer/src/components/ui/BaseInput.vue'
import BaseSelect from '../../src/renderer/src/components/ui/BaseSelect.vue'
import BaseMenu from '../../src/renderer/src/components/ui/BaseMenu.vue'
import BaseModal from '../../src/renderer/src/components/ui/BaseModal.vue'
import BaseAlert from '../../src/renderer/src/components/ui/BaseAlert.vue'
import BasePrompt from '../../src/renderer/src/components/ui/BasePrompt.vue'
import BaseActionSheet from '../../src/renderer/src/components/ui/BaseActionSheet.vue'
import BaseAccordion from '../../src/renderer/src/components/ui/BaseAccordion.vue'
import Tooltip from '../../src/renderer/src/components/ui/Tooltip.vue'
import BooleanToggle from '../../src/renderer/src/views/comfyUISettings/BooleanToggle.vue'
import EnvVarsField from '../../src/renderer/src/views/comfyUISettings/EnvVarsField.vue'
import ArgsRawInput from '../../src/renderer/src/views/comfyUISettings/ArgsRawInput.vue'
import ChooserView from '../../src/renderer/src/views/ChooserView.vue'
import GlobalSettingsView from '../../src/renderer/src/comfyTitlePopup/GlobalSettingsView.vue'
import FirstUseTakeover from '../../src/renderer/src/views/FirstUseTakeover.vue'
import type { DetailField } from '../../src/renderer/src/types/ipc'
import { settingsSnapshot } from './settingsSnapshot'

const scene = new URLSearchParams(location.search).get('scene') ?? 'controls'
const search = ref('')
const checked = ref<boolean | 'indeterminate'>(true)
const enabled = ref(true)
const expanded = ref(true)
const selection = ref('stable')
const action = ref('No action selected')
const modal = ref<string | null>(null)
const nestedOpen = ref(false)
const promptOpen = ref(false)
const sheetOpen = ref(false)
const submitted = ref('No value submitted')
const envField = ref<DetailField>({
  id: 'envVars',
  label: 'Environment variables',
  value: { API_TOKEN: 'fixture-secret', CUDA_VISIBLE_DEVICES: '0' }
})
const options = [
  { value: 'stable', label: 'Stable', description: 'Recommended release' },
  { value: 'nightly', label: 'Nightly', description: 'Latest changes' },
  { value: 'unavailable', label: 'Unavailable', disabled: true }
]
const items = [
  { id: 'open', label: 'Open installation' },
  { id: 'update', label: 'Update', disabled: true },
  { id: 'delete', label: 'Delete installation', style: 'danger' as const, separator: true }
]
</script>

<template>
  <div v-if="scene === 'first-use'" class="h-screen" data-testid="screen-first-use">
    <FirstUseTakeover />
  </div>
  <div v-else-if="scene === 'dashboard'" class="h-screen" data-testid="screen-dashboard">
    <ChooserView />
  </div>
  <div v-else-if="scene === 'settings'" class="h-screen p-6" data-testid="screen-settings">
    <GlobalSettingsView :snapshot="settingsSnapshot" />
  </div>
  <main
    v-else
    class="mx-auto flex max-w-[1080px] flex-col gap-8 px-8 py-10"
    data-testid="fixture-ready"
  >
    <header>
      <h1 class="text-2xl font-semibold text-foreground">Desktop shared components</h1>
      <p class="mt-2 text-sm text-muted-foreground">
        Production components, deterministic fixture data.
      </p>
    </header>
    <section class="grid grid-cols-2 gap-6" aria-label="Input states">
      <label class="flex flex-col gap-2 text-sm text-muted-foreground">
        Search
        <BaseInput
          v-model="search"
          placeholder="Search installations"
          aria-label="Search installations"
        >
          <template #leading><Search :size="16" /></template>
          <template #trailing>
            <Button variant="textonly" size="icon-sm" aria-label="Clear search" @click="search = ''"
              ><X :size="14"
            /></Button>
          </template>
        </BaseInput>
      </label>
      <label class="flex flex-col gap-2 text-sm text-muted-foreground">
        Readonly path
        <BaseInput model-value="/ComfyUI/Studio/models" readonly aria-label="Readonly path" />
      </label>
      <div class="flex flex-col gap-2 text-sm text-muted-foreground">
        Invalid startup arguments
        <ArgsRawInput
          model-value="--unknown-flag 123"
          :schema="[
            {
              name: 'port',
              flag: '--port',
              category: 'Network',
              type: 'value',
              metavar: 'PORT',
              help: 'Server port'
            }
          ]"
          aria-label="Invalid startup arguments"
        />
      </div>
      <label class="flex flex-col gap-2 text-sm text-muted-foreground">
        Release channel
        <BaseSelect v-model="selection" :options="options" aria-label="Release channel" />
        <span role="status">Selected: {{ selection }}</span>
      </label>
    </section>
    <section
      class="flex items-center gap-8 border-y border-border py-5"
      aria-label="Boolean controls"
    >
      <label class="flex items-center gap-3 text-sm"
        ><Checkbox v-model="checked" aria-label="Download models" /> Download models</label
      >
      <div class="flex items-center gap-3 text-sm">
        Enable previews
        <BooleanToggle
          :field="{ id: 'previews', label: 'Enable previews', value: enabled }"
          @update="enabled = $event"
        />
      </div>
      <div class="flex items-center gap-3 text-sm">
        Restricted setting
        <BooleanToggle
          :field="{ id: 'restricted', label: 'Restricted setting', value: false }"
          turn-on-disabled
        />
      </div>
    </section>
    <section aria-label="Environment editor" class="flex flex-col gap-3">
      <h2 class="text-base font-medium">Environment variables</h2>
      <EnvVarsField :field="envField" />
    </section>
    <section class="flex flex-col gap-4" aria-label="Popups and disclosure">
      <div class="flex items-center gap-5">
        <BaseMenu :items="items" trigger-aria-label="Installation actions" @select="action = $event"
          >Actions</BaseMenu
        >
        <Tooltip text="The shared tooltip remains readable near the trigger."
          ><Button variant="secondary" size="md">Tooltip trigger</Button></Tooltip
        >
        <Button variant="textonly" size="md" :aria-expanded="expanded" @click="expanded = !expanded"
          >Advanced options</Button
        >
        <span role="status" class="text-sm text-muted-foreground">{{ action }}</span>
      </div>
      <BaseAccordion :open="expanded">
        <div class="rounded-lg border border-border bg-secondary p-4 text-sm">
          Collapsed content leaves the keyboard focus order.
        </div>
      </BaseAccordion>
    </section>
    <section class="flex items-center gap-3" aria-label="Dialog examples">
      <Button size="md" variant="inverted" @click="modal = 'settings'">Open dialog</Button>
      <Button size="md" @click="modal = 'confirm'">Delete confirmation</Button>
      <Button size="md" @click="promptOpen = true">Rename installation</Button>
      <Button size="md" @click="sheetOpen = true">Choose action</Button>
      <span role="status" class="text-sm text-muted-foreground">{{ submitted }}</span>
    </section>
    <BaseModal :open="modal === 'settings'" aria-label="Installation options" @close="modal = null">
      <template #header><h2 class="text-lg font-semibold">Installation options</h2></template>
      <div class="flex flex-col gap-5">
        <BaseSelect v-model="selection" :options="options" aria-label="Dialog release channel" />
        <BaseMenu :items="items" trigger-aria-label="Dialog actions" @select="action = $event"
          >Actions</BaseMenu
        >
        <Button size="md" @click="nestedOpen = true">Open nested confirmation</Button>
      </div>
      <template #footer
        ><Button size="md" variant="inverted" @click="modal = null">Done</Button></template
      >
    </BaseModal>
    <BaseAlert
      :open="modal === 'confirm'"
      title="Delete installation?"
      message="This removes the installation and its local environment."
      button-label="Delete"
      show-cancel
      tone="danger"
      @close="modal = null"
      @cancel="modal = null"
    />
    <BaseAlert
      :open="nestedOpen"
      title="Confirm changes?"
      message="The parent dialog stays open."
      show-cancel
      @close="nestedOpen = false"
      @cancel="nestedOpen = false"
    />
    <BasePrompt
      v-model:open="promptOpen"
      title="Rename installation"
      input-label="Installation name"
      default-value="Studio"
      required
      @submit="submitted = $event"
    />
    <BaseActionSheet
      v-model:open="sheetOpen"
      title="Choose an action"
      :items="[
        {
          value: 'copy',
          label: 'Copy installation',
          description: 'Keep the original installation.'
        },
        { value: 'delete', label: 'Delete installation', tone: 'danger' }
      ]"
      @select="submitted = $event"
    />
  </main>
</template>
