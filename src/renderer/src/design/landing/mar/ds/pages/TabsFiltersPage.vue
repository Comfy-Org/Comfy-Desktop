<script setup lang="ts">
import { ref } from 'vue'
import { Box } from 'lucide-vue-next'
import AssetLayoutMenu from '../../assets/AssetLayoutMenu.vue'
import { noFilter, type AssetFilter } from '../../assets/assetFilters'
import AssetFilterMenu from '../../graph/AssetFilterMenu.vue'
import MarEmpty from '../../pages/MarEmpty.vue'
import MarSeg from '../../pages/MarSeg.vue'
import MarSearchField from '../../pages/MarSearchField.vue'
import MarViewToggle from '../../pages/MarViewToggle.vue'
import MarModeSeg from '../../modes/MarModeSeg.vue'
import TunerSeg from '../../tuner/TunerSeg.vue'
// Assets' type tabs show their counts (.mar-asset-seg, the Assets page's styles).
import '../../pages/MarAssetsPage.vue'
import AppShot from '../kit/AppShot.vue'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
import Stage from '../kit/Stage.vue'

// Assets' type tabs: every kind, with what it holds; an empty one stays.
const KINDS = [
  { value: 'all', label: 'All', count: 29 },
  { value: 'image', label: 'Images', count: 11 },
  { value: 'video', label: 'Videos', count: 10 },
  { value: '3d', label: '3D', count: 0 },
  { value: 'audio', label: 'Audio', count: 3 }
]
const MORE_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'other', label: 'Other' }
] as const
const TAGS = ['output', 'draft', 'lighting', 'portrait']
// Section tabs on an entity page (Project), the same component.
const SECTIONS = [
  { value: 'workflows', label: 'Workflows' },
  { value: 'assets', label: 'Assets' },
  { value: 'people', label: 'People' }
]
const WHERE = [
  { value: 'all', label: 'All' },
  { value: 'local', label: 'This computer' },
  { value: 'cloud', label: 'Cloud' }
]
const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'name', label: 'Name (A → Z)' }
]
const kind = ref('all')
const empty3d = ref('3d')
const section = ref('people')
const where = ref('all')
const none = ref(noFilter())
// Two on: a type and a date, as the badge counts them.
const two = ref<AssetFilter>({ ...noFilter(), types: ['text'], from: '2026-11-04' })
const folder = ref('')
const view = ref<'masonry' | 'rows' | 'grid'>('masonry')
const size = ref(2)
const sort = ref('newest')
const query = ref('')
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
// The toolbars in place, in app pixels (1280 × 800).
const TOOLBAR: [number, number, number, number] = [290, 172, 960, 60]
</script>

<template>
  <Section
    title="Toolbar"
    note="Tabs on the left; Filters, search and Layout on the right, Layout last. All share one corner: --mar-tab-radius on the track and --mar-tab-item-radius on what sits in it. No chips under it: the Filters badge says what's on."
  >
    <Cells :min="900">
      <Cell label="as on Assets" fill>
        <div class="mar-page is-embedded w-full">
          <div class="ds-tf-bar">
            <MarSeg v-model="kind" :options="KINDS" label="Type" class="mar-asset-seg" />
            <div class="ml-auto flex items-center gap-2">
              <AssetFilterMenu
                v-model="two"
                v-model:folder="folder"
                field
                source
                range
                types-label="More types"
                :types="MORE_TYPES"
                :tags="TAGS"
              />
              <MarSearchField v-model="query" placeholder="Search" shortcut />
              <AssetLayoutMenu
                v-model:view="view"
                v-model:size="size"
                v-model:sort="sort"
                :sorts="SORTS"
                :views="['masonry', 'rows', 'grid']"
              />
            </div>
          </div>
        </div>
      </Cell>
      <AppShot label="in place · Assets" page="assets" :crop="TOOLBAR" />
      <AppShot label="in place · Explore" page="explore" :crop="TOOLBAR" />
    </Cells>
  </Section>

  <Section
    title="Tabs"
    note="One tab for every page: MarSeg (mar/pages/MarSeg.vue). A soft track, no border; a pill slides to the picked tab, built into every tab group (Sliding pill, below). Counts stay off, except in Assets' type tabs. Underline tabs are retired: Pablo's ui/Tabs.vue draws this same track in the New UI."
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
    title="Type tabs: counts, and they stay"
    note="Assets' type tabs (All, Images, Videos, 3D, Audio) always show, empty or not, so the bar never shifts. Their counts sit in the tabs, not beside the title, and follow the open folder, filter and search (the type aside). An empty tab says what lands there; Nothing matches is only for a search or a filter."
  >
    <Cells :min="420">
      <Cell label="counts in the tabs">
        <MarSeg v-model="kind" :options="KINDS" label="Type" class="mar-asset-seg" />
      </Cell>
      <Cell label="an empty type, picked" fill>
        <div class="ds-tf-empty">
          <MarSeg v-model="empty3d" :options="KINDS" label="Type" class="mar-asset-seg" />
          <MarEmpty
            :icon="Box"
            title="No 3D files yet"
            text="Models your runs make land here. Upload one to start."
            compact
          />
        </div>
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
    title="Filters"
    note="One Filters field (graph/AssetFilterMenu.vue; Explore draws the same in explore/MarExplore.vue): an icon, Filters, a badge with how many are on, a chevron. No chips: the badge says what's on, and Clear filters (⌘⌫) is the menu's last line. Explore's groups are rows with values (Use case, Model, Runs on); see Menus."
  >
    <Cells :min="220">
      <Cell label="idle">
        <AssetFilterMenu v-model="none" field :types="MORE_TYPES" :tags="TAGS" />
      </Cell>
      <Cell label="two on · badge">
        <AssetFilterMenu v-model="two" field :types="MORE_TYPES" :tags="TAGS" />
      </Cell>
      <Cell label="hover" force="hover" target="button">
        <AssetFilterMenu v-model="none" field :types="MORE_TYPES" :tags="TAGS" />
      </Cell>
    </Cells>
    <Cells :min="420">
      <AppShot
        label="open · Assets (Clear filters last)"
        page="assets"
        run="assets-filters"
        :crop="[600, 180, 560, 520]"
      />
      <AppShot
        label="open · Explore (rows with values)"
        page="explore"
        run="explore-filters"
        :crop="[700, 180, 540, 180]"
      />
    </Cells>
  </Section>

  <Section
    title="Layout"
    note="Last in the bar (assets/AssetLayoutMenu.vue): Layout as icon tabs, Size as − a stepped bar +, then Sort by, Group by and Show where the page has them, each a row with its value. It replaces the Sort select and the view menu; Explore's cards keep Size and Sort by."
  >
    <Cells :min="220">
      <Cell label="idle">
        <AssetLayoutMenu
          v-model:view="view"
          v-model:size="size"
          v-model:sort="sort"
          :sorts="SORTS"
        />
      </Cell>
      <Cell label="hover" force="hover" target="button">
        <AssetLayoutMenu
          v-model:view="view"
          v-model:size="size"
          v-model:sort="sort"
          :sorts="SORTS"
        />
      </Cell>
    </Cells>
    <Cells :min="420">
      <Stage id="layout-menu" label="open" />
      <Stage id="layout-menu-sub" label="Sort by open" />
    </Cells>
  </Section>

  <Section
    title="Search and view"
    note="Search is the same control with its icon; ⌘/ finds it from anywhere on the page. The view toggle (grid or list) stays on the library pages that have no Layout menu."
  >
    <Cells :min="220">
      <Cell label="search · idle"
        ><MarSearchField v-model="query" placeholder="Search" shortcut
      /></Cell>
      <Cell label="search · focus" force="focus" target="label, input">
        <MarSearchField v-model="query" placeholder="Search" />
      </Cell>
      <Cell label="search · typed"><MarSearchField v-model="typed" placeholder="Search" /></Cell>
      <Cell label="view · grid"><MarViewToggle v-model="grid" /></Cell>
      <Cell label="view · list"><MarViewToggle v-model="list" /></Cell>
    </Cells>
  </Section>

  <Section
    title="Corners"
    note="UI Playground › Corners moves every tab, filter and search together: Default (10 / 7, the default) or Soft (14 / 11). The tab track sits 2px above the control radius."
  >
    <Cells :min="520">
      <AppShot
        label="Soft · 14 / 11"
        page="assets"
        :crop="TOOLBAR"
        :seed="{ [TUNING]: { radius: 'soft' } }"
      />
      <AppShot
        label="Default · 10 / 7 (default)"
        page="assets"
        :crop="TOOLBAR"
        :seed="{ [TUNING]: { radius: 'default' } }"
      />
    </Cells>
  </Section>
</template>

<style>
/* The page bar's row (MarPage's own style is scoped): tabs left, tools right. */
.ds-tf-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ds-tf-empty {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
</style>
