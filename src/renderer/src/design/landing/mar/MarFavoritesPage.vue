<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Star } from 'lucide-vue-next'
import AssetTile from '../parts/AssetTile.vue'
import TemplateCard from '../parts/TemplateCard.vue'
import { APPS, TEMPLATES, thumb } from '../mock'
import { allAssets } from '../gallery'
import { openApp } from '../appFlow'
import { go, toast } from '../useProto'
import FavoriteStar from './FavoriteStar.vue'
import { favoriteIds } from './favorites'
import MarEmpty from './pages/MarEmpty.vue'
import MarPage from './pages/MarPage.vue'
import MarSeg from './pages/MarSeg.vue'
import { shownState } from './pages/pageState'

/**
 * Favorites (Mar's proposal), rescued from her usertest-home prototype:
 * one tab per place a star comes from, each with its count. The page opens
 * on a tab that has something and follows the newest star. The frame is
 * MarPage: Loading and Error from the UI Playground, Empty from the stars
 * (with no stars, its MarEmpty says what starring saves here).
 */
type Tab = 'templates' | 'apps' | 'assets'

const templates = computed(() =>
  favoriteIds('template')
    .map((id) => TEMPLATES.find((t) => t.id === id))
    .filter((t) => t !== undefined)
)
const apps = computed(() =>
  favoriteIds('app')
    .map((id) => APPS.find((a) => a.id === id))
    .filter((a) => a !== undefined)
)
const assets = computed(() =>
  favoriteIds('asset')
    .map((id) => allAssets.value.find((a) => a.id === id))
    .filter((a) => a !== undefined)
)

const counts = computed<Record<Tab, number>>(() => ({
  templates: templates.value.length,
  apps: apps.value.length,
  assets: assets.value.length
}))
const TABS: { value: Tab; label: string }[] = [
  { value: 'templates', label: 'Templates' },
  { value: 'apps', label: 'Apps' },
  { value: 'assets', label: 'Assets' }
]
const hasAny = computed(() => Object.values(counts.value).some((n) => n > 0))

function firstFilled(): Tab {
  return TABS.find((t) => counts.value[t.value] > 0)?.value ?? 'templates'
}
const tab = ref<Tab>(firstFilled())
watch(counts, (next, prev) => {
  const grew = TABS.find((t) => next[t.value] > prev[t.value])
  if (grew) tab.value = grew.value
  else if (next[tab.value] === 0) tab.value = firstFilled()
})

// Loading and Error come from the Playground; Live or Empty from the stars.
const state = computed(() =>
  shownState.value === 'loading' || shownState.value === 'error'
    ? undefined
    : hasAny.value
      ? 'live'
      : 'empty'
)

// Three text-free pieces for the empty fan.
const FAN = ['image_z_image_turbo', 'video_ltx2_5_i2v', 'image_qwen_image_edit_2511'].map(thumb)
</script>

<template>
  <MarPage
    title="Favorites"
    :state
    :empty="{
      icon: Star,
      title: 'Star things to keep them here',
      text: 'Star a template, an app or an asset and it shows up here and in your sidebar, one click away.',
      pics: FAN,
      action: 'Browse Explore'
    }"
    error-title="Can't load your favorites"
    error-text="Starred things in Comfy Cloud are out of reach. Starred templates on this computer still open."
    @action="go('explore')"
  >
    <template #toolbar>
      <MarSeg v-model="tab" :options="TABS" label="Favorites" />
    </template>

    <div v-if="tab === 'templates' && templates.length" class="mar-fav-grid">
      <TemplateCard v-for="t in templates" :key="t.id" :t />
    </div>
    <div v-else-if="tab === 'apps' && apps.length" class="mar-fav-grid">
      <button
        v-for="a in apps"
        :key="a.id"
        type="button"
        class="mar-ex-card group"
        @click="openApp(a.id)"
      >
        <span class="mar-fav-media"
          ><img :src="thumb(a.thumbId)" alt="" loading="lazy" /><span class="mar-fav-corner"
            ><FavoriteStar :id="a.id" kind="app" /></span
        ></span>
        <span class="flex flex-col gap-0.5 px-2 pt-2.5 pb-2 text-left">
          <span class="truncate text-ui font-medium text-base-foreground">{{ a.name }}</span>
          <span class="truncate text-ui text-subtle-foreground"
            >{{ a.owner }} · {{ a.runs.toLocaleString('en-US') }} runs</span
          >
        </span>
      </button>
    </div>
    <div v-else-if="tab === 'assets' && assets.length" class="mar-fav-grid">
      <AssetTile v-for="a in assets" :key="a.id" :asset="a" @open="toast(`Open ${a.name}`)" />
    </div>
    <MarEmpty
      v-else
      compact
      :icon="Star"
      :title="`No starred ${tab} yet`"
      text="Star one and it shows up here."
    />
  </MarPage>
</template>

<style scoped>
.mar-fav-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}
.mar-fav-media {
  position: relative;
  display: block;
  overflow: hidden;
  border-radius: var(--radius-control);
  aspect-ratio: 16 / 10;
}
.mar-fav-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mar-fav-corner {
  position: absolute;
  top: 8px;
  right: 8px;
}
</style>
