<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Star } from 'lucide-vue-next'
import PageHeader from '../ui/PageHeader.vue'
import AssetTile from '../parts/AssetTile.vue'
import TemplateCard from '../parts/TemplateCard.vue'
import { APPS, TEMPLATES, thumb } from '../mock'
import { allAssets } from '../gallery'
import { go, toast, type Page } from '../useProto'
import FavoriteStar from './FavoriteStar.vue'
import { favoriteIds } from './favorites'
import MarEmpty from './pages/MarEmpty.vue'

/**
 * Favorites (Mar's proposal), rescued from her usertest-home prototype:
 * one tab per place a star comes from, each with its count. The page opens
 * on a tab that has something and follows the newest star. Empty, the
 * shared MarEmpty (born here) says what starring saves here.
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

// Three text-free pieces for the empty fan.
const FAN = ['image_z_image_turbo', 'video_ltx2_5_i2v', 'image_qwen_image_edit_2511'].map(thumb)
</script>

<template>
  <div class="mx-auto w-full max-w-300 px-10 pb-16">
    <PageHeader title="Favorites" />

    <template v-if="hasAny">
      <div class="mar-fav-tabs" role="tablist" aria-label="Favorites">
        <button
          v-for="t in TABS"
          :key="t.value"
          type="button"
          role="tab"
          :aria-selected="tab === t.value"
          class="mar-ex-tab"
          @click="tab = t.value"
        >
          {{ t.label }}<span class="mar-fav-count">{{ counts[t.value] }}</span>
        </button>
      </div>

      <div v-if="tab === 'templates' && templates.length" class="mar-fav-grid">
        <TemplateCard v-for="t in templates" :key="t.id" :t />
      </div>
      <div v-else-if="tab === 'apps' && apps.length" class="mar-fav-grid">
        <button
          v-for="a in apps"
          :key="a.id"
          type="button"
          class="mar-ex-card group"
          @click="go(`app:${a.id}` as Page)"
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
      <p v-else class="py-16 text-center text-ui text-subtle-foreground">Nothing here yet.</p>
    </template>

    <MarEmpty
      v-else
      :icon="Star"
      title="Star things to keep them here"
      text="Star a template, an app or an asset and it shows up here and in your sidebar, one click away."
      :pics="FAN"
      action="Browse Explore"
      @action="go('explore')"
    />
  </div>
</template>

<style scoped>
.mar-fav-tabs {
  display: inline-flex;
  gap: 2px;
  margin: 8px 0 20px;
  padding: 3px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
}
.mar-fav-count {
  margin-left: 6px;
  color: var(--color-subtle-foreground);
  font-variant-numeric: tabular-nums;
}
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
