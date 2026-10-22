<script setup lang="ts">
import { computed } from 'vue'
import { Megaphone, MessageSquarePlus, PlayCircle } from 'lucide-vue-next'
import Badge from '../ui/Badge.vue'
import Card from '../ui/Card.vue'
import MediaCard from '../ui/MediaCard.vue'
import Meter from '../ui/Meter.vue'
import ScrollRow from '../ui/ScrollRow.vue'
import SectionHeader from '../ui/SectionHeader.vue'
import BrandButton from '../parts/space/BrandButton.vue'
import OutputTile from '../parts/space/OutputTile.vue'
import SpaceMark from '../parts/space/SpaceMark.vue'
import ToolCard from '../parts/space/ToolCard.vue'
import { fmt } from '../parts/env/env'
import { clientUser, GUIDES, STUDIO, THEME_FONT, type Space } from '../spaces'
import { proto, toast } from '../useProto'
import { thumb } from '../mock'

/** The space's home, laid out by the studio (Space -> Home & brand). */
const { space } = defineProps<{ space: Space }>()
const first = computed(() => clientUser.value.name.split(' ')[0] ?? '')
const headline = computed(
  () => space.brand.headline.trim().replaceAll('{name}', first.value) || `Welcome, ${first.value}`
)
const theme = computed(() => space.brand.theme)
const tools = computed(() => space.catalog.filter((c) => c.visible))
const pinned = (ids: string[]) =>
  ids.map((id) => space.catalog.find((c) => c.id === id)).filter((c) => !!c && c.visible)
const open = (p: string): void => {
  proto.portalPage = p
}
</script>

<template>
  <!-- Brand hero: the brand colour, its type and logo. No imagery. -->
  <div class="relative -ml-(--rail) h-100 overflow-hidden">
    <div
      class="absolute inset-0"
      :style="{
        background: `linear-gradient(180deg, color-mix(in srgb, ${space.brand.color} 55%, var(--brand-surface)) 0%, var(--brand-surface) 100%)`
      }"
    />
    <div
      class="relative mx-auto flex h-full max-w-280 flex-col items-center justify-center px-10 text-center"
    >
      <SpaceMark :brand="space.brand" size="lg" />
      <h1
        :class="['mt-5 text-display text-white', theme?.uppercase && 'uppercase']"
        :style="theme ? THEME_FONT[theme.font] : undefined"
      >
        {{ headline }}
      </h1>
    </div>
  </div>
  <div class="relative mx-auto w-full max-w-280 px-10 pb-16">
    <template v-for="s in space.sections.filter((x) => x.visible)" :key="s.id">
      <Card
        v-if="s.builtin === 'announcement' && space.brand.announcement"
        variant="glass"
        class="mx-auto mt-8 flex max-w-2xl items-start gap-3 p-4"
      >
        <Megaphone :size="16" class="mt-0.5 shrink-0 text-(--brand)" />
        <div>
          <p class="text-ui text-subtle-foreground">From {{ STUDIO.name }}</p>
          <p class="mt-0.5 text-ui">{{ space.brand.announcement }}</p>
        </div>
      </Card>

      <section v-else-if="s.pin" class="mt-10">
        <SectionHeader :title="s.title" />
        <div class="grid grid-cols-3 gap-3.5">
          <ToolCard
            v-for="t in pinned(s.pin)"
            :key="t!.id"
            :item="t!"
            @open="open(`tool:${t!.id}`)"
          />
        </div>
      </section>

      <section v-else-if="s.builtin === 'tools'" class="mt-10">
        <SectionHeader :title="s.title" link="All tools" @link="open('tools')" />
        <ScrollRow :columns="3.4" :min="240">
          <ToolCard v-for="t in tools" :key="t.id" :item="t" @open="open(`tool:${t.id}`)" />
        </ScrollRow>
      </section>

      <section v-else-if="s.builtin === 'recent' && space.library.length" class="mt-10">
        <SectionHeader :title="s.title" />
        <div class="grid grid-cols-4 gap-3.5">
          <Card
            v-for="o in space.library.slice(0, 4)"
            :key="o.id"
            as="button"
            interactive
            class="flex items-center gap-3 p-2 text-left"
            @click="open(`tool:${space.catalog.find((c) => c.name === o.tool)?.id}`)"
          >
            <img :src="thumb(o.thumbId)" alt="" class="size-12 rounded-control object-cover" />
            <span class="min-w-0">
              <span class="block truncate text-ui font-medium">{{ o.tool }}</span>
              <span class="text-ui text-subtle-foreground">{{ o.when }}</span>
            </span>
          </Card>
        </div>
      </section>

      <section v-else-if="s.builtin === 'library' && space.library.length" class="mt-10">
        <SectionHeader :title="s.title" link="Library" @link="open('library')" />
        <ScrollRow :columns="5.4" :min="160">
          <OutputTile v-for="o in space.library" :key="o.id" :out="o" :space />
        </ScrollRow>
      </section>

      <section v-else-if="s.builtin === 'guides'" class="mt-10">
        <SectionHeader :title="s.title" />
        <div class="grid grid-cols-3 gap-3.5">
          <MediaCard
            v-for="g in GUIDES"
            :key="g.title"
            :src="thumb(g.thumbId)"
            ratio="16/9"
            @click="toast(`Guide: ${g.title}`)"
          >
            <template #bottom-right
              ><Badge variant="overlay" size="md"
                ><PlayCircle :size="11" />{{ g.minutes }} min</Badge
              ></template
            >
            <p class="text-ui font-medium">{{ g.title }}</p>
          </MediaCard>
        </div>
      </section>

      <Card
        v-else-if="s.builtin === 'request'"
        variant="dashed"
        class="mt-10 flex items-center gap-4 p-5"
      >
        <MessageSquarePlus :size="20" class="shrink-0 text-muted-foreground" />
        <div class="flex-1">
          <p class="text-ui font-semibold">Need something that isn't here?</p>
          <p class="text-ui text-muted-foreground">
            Describe it and {{ STUDIO.name }} builds it into your space.
          </p>
        </div>
        <BrandButton @click="open('requests')">Request a tool</BrandButton>
      </Card>

      <section v-else-if="s.builtin === 'usage'" class="mt-10">
        <SectionHeader :title="s.title" link="Usage" @link="open('usage')" />
        <Card class="flex items-center gap-6 p-5">
          <div class="flex-1">
            <p class="text-ui text-muted-foreground">
              <span class="text-heading font-semibold text-base-foreground tabular-nums">{{
                fmt(space.budget - space.used)
              }}</span>
              of {{ fmt(space.budget) }} credits left this month
            </p>
            <Meter :value="space.used" :max="space.budget" class="mt-3" />
          </div>
          <p class="text-ui text-subtle-foreground">Resets Nov 1</p>
        </Card>
      </section>
    </template>
  </div>
</template>
