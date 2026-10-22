<script setup lang="ts">
import { ref } from 'vue'
import { Cloud, Laptop, LayoutGrid, Search } from 'lucide-vue-next'
import Checkbox from '../../landing/ui/Checkbox.vue'
import Input from '../../landing/ui/Input.vue'
import NumberField from '../../landing/ui/NumberField.vue'
import SearchInput from '../../landing/ui/SearchInput.vue'
import SegmentedControl from '../../landing/ui/SegmentedControl.vue'
import Select from '../../landing/ui/Select.vue'
import Switch from '../../landing/ui/Switch.vue'
import Tabs from '../../landing/ui/Tabs.vue'
import GallerySection from '../parts/GallerySection.vue'
import Specimen from '../parts/Specimen.vue'
import VariantGroup from '../parts/VariantGroup.vue'
import Stage from '../parts/Stage.vue'
import { state } from '../playground'
import { thumb } from '../../landing/mock'

const f = state.field
const sg = state.segmented
const text = ref('')
const count = ref(4)
const size = ref(12)
const search = ref('')
const sort = ref('recent')
const SORTS = [
  { value: 'recent', label: 'Last edited' },
  { value: 'name', label: 'Name' }
]
const where = ref('all')
const tab = ref('workflows')
const on = ref(true)
const off = ref(false)
const checked = ref(true)
const unchecked = ref(false)
const overlay = ref(true)
</script>

<template>
  <GallerySection
    id="fields"
    title="Fields"
    description="Input, search and select share one shell, so they line up in filter bars and share hover and focus."
    tweak-key="field"
  >
    <Stage>
      <div class="w-72">
        <Input
          v-if="f.kind === 'input'"
          v-model="text"
          :size="f.size as never"
          :mono="!!f.mono"
          :placeholder="String(f.placeholder)"
        />
        <SearchInput
          v-else-if="f.kind === 'search'"
          v-model="search"
          :size="f.size as never"
          :placeholder="String(f.placeholder)"
        />
        <Select v-else v-model="sort" :size="f.size as never" label="Sort" :options="SORTS" />
      </div>
    </Stage>
    <VariantGroup title="Component" note="One shell for every text-entry control." cell="lg">
      <Specimen label="Input" fill><Input v-model="text" placeholder="Workflow name" /></Specimen>
      <Specimen label="SearchInput" fill
        ><SearchInput v-model="search" placeholder="Search workflows"
      /></Specimen>
      <Specimen label="Select" fill
        ><Select v-model="sort" label="Sort" :options="SORTS"
      /></Specimen>
      <Specimen label="NumberField"
        ><NumberField v-model="count" :min="1" :max="16" aria-label="Images" class="w-28"
      /></Specimen>
    </VariantGroup>
    <VariantGroup title="Options" cell="lg">
      <Specimen label="mono" fill><Input model-value="nike-product-relight" mono /></Specimen>
      <Specimen label="#leading slot" fill>
        <Input placeholder="Filter"
          ><template #leading><Search :size="13" class="text-subtle-foreground" /></template
        ></Input>
      </Specimen>
      <Specimen label='variant="ghost" · Select'
        ><Select v-model="sort" variant="ghost" :options="SORTS"
      /></Specimen>
      <Specimen label='unit="px" · NumberField'
        ><NumberField
          v-model="size"
          :min="8"
          :max="32"
          unit="px"
          aria-label="Font size"
          class="w-28"
      /></Specimen>
    </VariantGroup>
    <VariantGroup title="State" prop="disabled" cell="lg">
      <Specimen label="disabled" fill><Input placeholder="Read only" disabled /></Specimen>
    </VariantGroup>
  </GallerySection>

  <GallerySection
    id="segmented"
    title="Segmented control"
    description="One choice from a few. Contained for primary scopes (All / This computer / Cloud); plain for quiet section switches."
    tweak-key="segmented"
  >
    <Stage>
      <SegmentedControl
        v-model="where"
        :variant="sg.variant as never"
        :size="sg.size as never"
        :options="[
          { value: 'all', label: 'All', count: sg.counts ? 12 : undefined },
          {
            value: 'local',
            label: 'This computer',
            icon: sg.icons ? Laptop : undefined,
            count: sg.counts ? 6 : undefined
          },
          {
            value: 'cloud',
            label: 'Cloud',
            icon: sg.icons ? Cloud : undefined,
            count: sg.counts ? 6 : undefined
          }
        ]"
      />
    </Stage>
    <VariantGroup title="Variant" prop="variant" cell="md">
      <Specimen v-for="v in ['plain', 'contained'] as const" :key="v" :label="v">
        <SegmentedControl
          v-model="where"
          :variant="v"
          :options="[
            { value: 'all', label: 'All' },
            { value: 'local', label: 'Local' },
            { value: 'cloud', label: 'Cloud' }
          ]"
        />
      </Specimen>
    </VariantGroup>
    <VariantGroup title="Size" prop="size" cell="md">
      <Specimen v-for="sz in ['md', 'sm'] as const" :key="sz" :label="sz">
        <SegmentedControl
          v-model="where"
          variant="contained"
          :size="sz"
          :options="[
            { value: 'all', label: 'All' },
            { value: 'local', label: 'Local' },
            { value: 'cloud', label: 'Cloud' }
          ]"
        />
      </Specimen>
    </VariantGroup>
    <VariantGroup title="Content" note="Icon-only options need an ariaLabel." cell="md">
      <Specimen label="icon only">
        <SegmentedControl
          v-model="where"
          variant="contained"
          size="sm"
          :options="[
            { value: 'all', icon: LayoutGrid, ariaLabel: 'All' },
            { value: 'local', icon: Laptop, ariaLabel: 'Local' },
            { value: 'cloud', icon: Cloud, ariaLabel: 'Cloud' }
          ]"
        />
      </Specimen>
    </VariantGroup>
  </GallerySection>

  <GallerySection
    id="tabs"
    :components="['Tabs']"
    title="Tabs"
    description="Page-level views with a sliding underline."
  >
    <Tabs
      v-model="tab"
      :options="[
        { value: 'workflows', label: 'Workflows', count: 12 },
        { value: 'assets', label: 'Assets' },
        { value: 'settings', label: 'Settings' }
      ]"
    >
      <p class="pt-4 text-ui text-muted-foreground">Content for {{ tab }}.</p>
    </Tabs>
  </GallerySection>

  <GallerySection
    id="toggles"
    :components="['Switch', 'Checkbox']"
    title="Switch and checkbox"
    description="Switch applies at once; checkbox selects for a later action."
  >
    <VariantGroup title="Switch" note="Applies at once." cell="md">
      <Specimen label="label" fill><Switch v-model="on" label="Keep warm" /></Specimen>
      <Specimen label="aria-label (bare)"><Switch v-model="off" aria-label="Visible" /></Specimen>
    </VariantGroup>
    <VariantGroup title="Checkbox" prop="variant" note="Selects for a later action.">
      <Specimen label="default · on"><Checkbox v-model="checked" /></Specimen>
      <Specimen label="default · off"><Checkbox v-model="unchecked" /></Specimen>
      <Specimen label="overlay" bleed>
        <img :src="thumb('image_flux2')" alt="" class="absolute inset-0 size-full object-cover" />
        <Checkbox v-model="overlay" variant="overlay" class="relative" />
      </Specimen>
    </VariantGroup>
  </GallerySection>
</template>
