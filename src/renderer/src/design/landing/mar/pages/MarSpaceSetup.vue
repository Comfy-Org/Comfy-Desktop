<script setup lang="ts">
import { computed } from 'vue'
import {
  Check,
  Database,
  Eye,
  Lock,
  MapPin,
  Palette,
  Rocket,
  UserPlus,
  Wrench
} from 'lucide-vue-next'
import Button from '../../ui/Button.vue'
import Card from '../../ui/Card.vue'
import SpaceMark from '../../parts/space/SpaceMark.vue'
import { previewSpace, type Space } from '../../spaces'
import { thumb } from '../../mock'

/**
 * A space with nothing to measure yet (Mar's proposal): instead of a
 * dashboard of zeros, the four things that make it work, each ticked from
 * the space's own data, next to what the client will see. The dashboard
 * (MarSpaceOverview) takes over once people use it.
 */
const { space } = defineProps<{ space: Space }>()
const emit = defineEmits<{ tab: [tab: 'catalog' | 'home']; invite: []; live: [] }>()

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

const steps = computed(() => {
  const tools = space.catalog
  const people = space.members
  return [
    {
      icon: Wrench,
      title: 'Publish a tool',
      done: tools.length > 0,
      text: tools.length
        ? `${plural(tools.length, 'tool')}: ${tools.map((t) => t.name).join(', ')}`
        : 'Members run your apps and workflows here, without seeing a graph.',
      action: tools.length ? 'Open' : 'Add a tool',
      run: () => emit('tab', 'catalog')
    },
    {
      icon: Palette,
      title: 'Make it theirs',
      done: Boolean(space.brand.headline),
      text: space.brand.headline
        ? `“${space.brand.headline}”`
        : 'Write the home’s headline and choose how much of their look it takes.',
      action: space.brand.headline ? 'Edit' : 'Set up the home',
      run: () => emit('tab', 'home')
    },
    {
      icon: UserPlus,
      title: 'Invite the client’s team',
      done: people.length > 0,
      text: people.length
        ? plural(people.length, 'person')
        : `They sign in at ${space.domain} and only ever see this space.`,
      action: people.length ? 'Invite more' : 'Invite people',
      run: () => emit('invite')
    },
    {
      icon: Rocket,
      title: 'Go live',
      done: space.status !== 'draft',
      text:
        space.status === 'draft'
          ? `Turns on ${space.domain} and sends the invites.`
          : `Live at ${space.domain}`,
      action: space.status === 'draft' ? 'Go live' : '',
      run: () => emit('live')
    }
  ]
})
const doneCount = computed(() => steps.value.filter((s) => s.done).length)
// The next step to take gets the one primary button.
const next = computed(() => steps.value.findIndex((s) => !s.done))

// What members land on: the brand's own surface when it has one.
const site = computed(() => ({
  surface: space.brand.theme?.surface,
  tools: space.catalog.slice(0, 3)
}))

const ISOLATION = computed(() => [
  { icon: Database, value: 'Own bucket, encrypted' },
  { icon: Lock, value: 'Never used to train models' },
  { icon: MapPin, value: space.region }
])
</script>

<template>
  <div class="mar-ss">
    <div class="mar-ss-main">
      <Card class="mar-ss-steps">
        <div class="mar-ss-head">
          <div class="min-w-0 flex-1">
            <p class="mar-ss-title">Get this space ready</p>
            <p class="mar-ss-sub">Numbers show up here once the client’s team starts using it.</p>
          </div>
          <span class="mar-ss-progress">{{ doneCount }} of {{ steps.length }}</span>
        </div>
        <span class="mar-ss-bar"
          ><i :style="{ width: `${(doneCount / steps.length) * 100}%` }"
        /></span>
        <ol class="mar-ss-list">
          <li
            v-for="(s, i) in steps"
            :key="s.title"
            class="mar-ss-step"
            :class="s.done && 'is-done'"
          >
            <span class="mar-ss-mark">
              <Check v-if="s.done" :size="14" :stroke-width="2.5" />
              <component :is="s.icon" v-else :size="15" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="mar-ss-step-title">{{ s.title }}</p>
              <p class="mar-ss-step-text">{{ s.text }}</p>
            </div>
            <Button
              v-if="s.action"
              :variant="i === next ? 'primary' : s.done ? 'ghost' : 'secondary'"
              size="sm"
              @click="s.run"
              >{{ s.action }}</Button
            >
          </li>
        </ol>
      </Card>

      <!-- What the client lands on, as it stands now. -->
      <Card class="mar-ss-preview">
        <div
          class="mar-ss-site"
          :class="site.surface && 'is-branded'"
          :style="{ '--site': site.surface }"
        >
          <SpaceMark :brand="space.brand" size="md" />
          <p class="mar-ss-site-headline" :class="!space.brand.headline && 'is-empty'">
            {{ space.brand.headline || 'Your headline goes here' }}
          </p>
          <div class="mar-ss-site-tools">
            <img v-for="t in site.tools" :key="t.id" :src="thumb(t.thumbId)" alt="" />
            <i v-for="n in 3 - site.tools.length" :key="n" />
          </div>
        </div>
        <div class="mar-ss-preview-foot">
          <div class="min-w-0 flex-1">
            <p class="mar-ss-step-title">What the client sees</p>
            <p class="mar-ss-step-text truncate">{{ space.domain }}</p>
          </div>
          <Button size="sm" @click="previewSpace(space.id)"><Eye :size="14" />Preview</Button>
        </div>
      </Card>
    </div>

    <!-- Kept apart from day one: said once, quietly. -->
    <p class="mar-ss-iso">
      <span v-for="f in ISOLATION" :key="f.value"
        ><component :is="f.icon" :size="13" />{{ f.value }}</span
      >
    </p>
  </div>
</template>

<style scoped>
.mar-ss {
  display: flex;
  flex-direction: column;
  gap: 14px;
  container-type: inline-size;
}
.mar-ss-main {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
@container (max-width: 760px) {
  .mar-ss-main {
    grid-template-columns: minmax(0, 1fr);
  }
  /* Stacked, the miniature keeps its size instead of filling the width. */
  .mar-ss-site-tools {
    max-width: 340px;
  }
}
.mar-ss-steps {
  padding: 20px 20px 8px;
}
.mar-ss-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.mar-ss-title {
  color: var(--color-base-foreground);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.mar-ss-sub {
  margin-top: 2px;
  color: var(--color-subtle-foreground);
  font-size: 13px;
}
.mar-ss-progress {
  flex-shrink: 0;
  color: var(--color-muted-foreground);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.mar-ss-bar {
  display: block;
  height: 4px;
  margin: 14px 0 6px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
}
.mar-ss-bar > i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: color-mix(in oklch, var(--color-base-foreground) 70%, transparent);
  transition: width 300ms ease;
}
.mar-ss-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.mar-ss-step {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 0;
}
.mar-ss-step + .mar-ss-step {
  border-top: 1px solid var(--color-border-default);
}
.mar-ss-mark {
  display: grid;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  place-items: center;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  color: var(--color-muted-foreground);
}
.is-done .mar-ss-mark {
  border-color: transparent;
  background: color-mix(in oklch, var(--color-base-foreground) 10%, transparent);
  color: var(--color-base-foreground);
}
.mar-ss-step-title {
  color: var(--color-base-foreground);
  font-size: 14px;
  font-weight: 500;
}
.is-done .mar-ss-step-title {
  color: var(--color-muted-foreground);
}
.mar-ss-step-text {
  margin-top: 1px;
  color: var(--color-subtle-foreground);
  font-size: 13px;
}
.is-done .mar-ss-step-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The client's home in miniature: their surface if the brand has one,
   otherwise the card's own. */
.mar-ss-preview {
  overflow: hidden;
}
.mar-ss-site {
  --site-fg: var(--color-base-foreground);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 20px;
  background: color-mix(in oklch, var(--color-base-foreground) 4%, transparent);
  border-bottom: 1px solid var(--color-border-default);
}
.mar-ss-site.is-branded {
  --site-fg: #fff;
  background: var(--site);
}
.mar-ss-site-headline {
  max-width: 100%;
  color: var(--site-fg);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.25;
}
.mar-ss-site-headline.is-empty {
  opacity: 0.4;
}
.mar-ss-site-tools {
  display: grid;
  width: 100%;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.mar-ss-site-tools > img,
.mar-ss-site-tools > i {
  aspect-ratio: 4 / 3;
  width: 100%;
  border-radius: 8px;
  object-fit: cover;
}
.mar-ss-site-tools > i {
  border: 1px dashed color-mix(in oklch, var(--site-fg) 22%, transparent);
}
.mar-ss-preview-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px 14px 20px;
}

.mar-ss-iso {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
  padding: 0 4px;
  color: var(--color-subtle-foreground);
  font-size: 13px;
}
.mar-ss-iso > span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
</style>
