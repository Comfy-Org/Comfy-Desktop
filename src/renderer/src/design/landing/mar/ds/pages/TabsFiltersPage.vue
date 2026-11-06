<script setup lang="ts">
import { ref } from 'vue'
import Select from '../../../ui/Select.vue'
import MarSeg from '../../pages/MarSeg.vue'
import MarSearchField from '../../pages/MarSearchField.vue'
import MarViewToggle from '../../pages/MarViewToggle.vue'
import MarModeSeg from '../../modes/MarModeSeg.vue'
import TunerSeg from '../../tuner/TunerSeg.vue'
import AppShot from '../kit/AppShot.vue'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
import Stage from '../kit/Stage.vue'

const WHERE = [
  { value: 'all', label: 'All', count: 24 },
  { value: 'local', label: 'This computer', count: 16 },
  { value: 'cloud', label: 'Cloud', count: 8 }
]
const TYPES = [
  { value: 'any', label: 'Any type' },
  { value: 'image', label: 'Image' }
]
const SORTS = [
  { value: 'recent', label: 'Last opened' },
  { value: 'name', label: 'Name' }
]
// Section tabs on an entity page (Project), the same component.
const SECTIONS = [
  { value: 'workflows', label: 'Workflows' },
  { value: 'assets', label: 'Assets' },
  { value: 'people', label: 'People' }
]
const where = ref('all')
const section = ref('people')
const type = ref('any')
const sort = ref('recent')
const empty = ref('')
const typed = ref('portrait')
const grid = ref<'grid' | 'list'>('grid')
const list = ref<'grid' | 'list'>('list')
// The Create / Build switch (MarModeSeg): a radiogroup, so it slides too.
const MODES = [
  { value: 'create', label: 'Create' },
  { value: 'build', label: 'Build' }
]
const mode = ref('create')
const slid = ref<'grid' | 'list'>('grid')
const TUNING = 'comfy.design.uiTuning.v5'
// The Workflows toolbar, in app pixels.
const TOOLBAR: [number, number, number, number] = [276, 263, 972, 66]
</script>

<template>
  <Section
    title="Toolbar"
    note="Tabs on the left, filters, sort, search and view on the right. All share one corner: --mar-tab-radius on the track and --mar-tab-item-radius on what sits in it."
  >
    <Cells :min="900">
      <Cell label="as on Workflows" fill>
        <div class="mar-page is-embedded">
          <div class="mar-page-bar">
            <MarSeg v-model="where" :options="WHERE" label="Where" />
            <div class="ml-auto flex items-center gap-2">
              <Select v-model="type" :options="TYPES" class="w-32" />
              <Select v-model="sort" :options="SORTS" label="Sort" class="w-40" />
              <MarSearchField v-model="empty" placeholder="Search workflows" />
              <MarViewToggle v-model="grid" />
            </div>
          </div>
        </div>
      </Cell>
    </Cells>
  </Section>

  <Section
    title="Tabs"
    note="One tab for every page: MarSeg (mar/pages/MarSeg.vue). A soft track, no border; a pill slides to the picked tab, built into every tab group (Sliding pill, below). Counts are hidden for now. Underline tabs are retired: Pablo's ui/Tabs.vue draws this same track in the New UI."
  >
    <Cells :min="320">
      <Cell label="sections · Project">
        <MarSeg v-model="section" :options="SECTIONS" label="In this project" />
      </Cell>
      <Cell label="idle"><MarSeg v-model="where" :options="WHERE" label="Where" /></Cell>
      <Cell label="tab hover" force="hover" target="button:nth-of-type(2)">
        <MarSeg v-model="where" :options="WHERE" label="Where" />
      </Cell>
      <Cell label="tab focus" force="focus" target="button:nth-of-type(2)">
        <MarSeg v-model="where" :options="WHERE" label="Where" />
      </Cell>
    </Cells>
  </Section>

  <Section
    title="Sliding pill"
    note="Part of every tab group, with no opt-in: one pill sits behind the picked option and glides to the next (280ms, out-expo). motion/tabSlide.ts finds each group as it mounts: tablists, radiogroups, toggle groups, .mar-seg and .mar-pseg rows, so MarSeg, Pablo's ui/Tabs.vue, the Create / Build switch (MarModeSeg), the view toggle and the Playground's Seg all get it. A group opts out with data-no-pill (carousel dots). Reduced motion: the pill jumps."
  >
    <Cells :min="260">
      <Cell label="tabs · MarSeg"><MarSeg v-model="where" :options="WHERE" label="Where" /></Cell>
      <Cell label="mode · MarModeSeg">
        <MarModeSeg v-model="mode" :options="MODES" />
      </Cell>
      <Cell label="radiogroup · view"><MarViewToggle v-model="slid" /></Cell>
      <Cell label="segmented · Playground">
        <TunerSeg v-model="mode" :options="MODES" label="Mode" />
      </Cell>
    </Cells>
  </Section>

  <Section
    title="Filters and sort"
    note="Controls on the tab corner, never fully round: muted label, white value, no edge; a step lighter on hover and while open. Sort shows as an icon (ArrowUpDown)."
  >
    <Cells :min="200">
      <Cell label="filter"><Select v-model="type" :options="TYPES" class="w-32" /></Cell>
      <Cell label="sort"><Select v-model="sort" :options="SORTS" label="Sort" class="w-40" /></Cell>
      <Cell label="hover" force="hover" target="button">
        <Select v-model="sort" :options="SORTS" label="Sort" class="w-40" />
      </Cell>
      <Cell label="open" target="button" :attrs="{ 'data-state': 'open' }">
        <Select v-model="sort" :options="SORTS" label="Sort" class="w-40" />
      </Cell>
    </Cells>
  </Section>

  <Section
    title="Search and view"
    note="Search is the same control with its icon. The view toggle is a small track: grid or list."
  >
    <Cells :min="220">
      <Cell label="search · idle"
        ><MarSearchField v-model="empty" placeholder="Search workflows"
      /></Cell>
      <Cell label="search · focus" force="focus" target="label, input">
        <MarSearchField v-model="empty" placeholder="Search workflows" />
      </Cell>
      <Cell label="search · typed"
        ><MarSearchField v-model="typed" placeholder="Search workflows"
      /></Cell>
      <Cell label="view · grid"><MarViewToggle v-model="grid" /></Cell>
      <Cell label="view · list"><MarViewToggle v-model="list" /></Cell>
      <Cell label="view · hover" force="hover" target="button:nth-of-type(2)">
        <MarViewToggle v-model="grid" />
      </Cell>
    </Cells>
  </Section>

  <Section
    title="View menu"
    note="Assets: size, layout and details, in sections with hints. Its trigger takes the tab corner."
  >
    <Cells :min="420"><Stage id="view-menu" label="open" /></Cells>
  </Section>

  <Section
    title="Corners"
    note="UI Playground › Corners moves every tab, filter and search together: Default (10 / 7, the default) or Soft (14 / 11). The tab track sits 2px above the control radius."
  >
    <Cells :min="520">
      <AppShot
        label="Soft · 14 / 11"
        page="workflows"
        :crop="TOOLBAR"
        :seed="{ [TUNING]: { radius: 'soft' } }"
      />
      <AppShot
        label="Default · 10 / 7 (default)"
        page="workflows"
        :crop="TOOLBAR"
        :seed="{ [TUNING]: { radius: 'default' } }"
      />
    </Cells>
  </Section>
</template>
