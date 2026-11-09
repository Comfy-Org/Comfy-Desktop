<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

/**
 * Filters › Date › Custom range: one month, in the menu's own style. The
 * first click sets the start, the second the end (either order); a third
 * starts over. Dates are ISO days (2026-11-09).
 */
const from = defineModel<string>('from', { required: true })
const to = defineModel<string>('to', { required: true })

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = iso(new Date())
const start = from.value ? new Date(`${from.value}T00:00`) : new Date()
const month = ref(new Date(start.getFullYear(), start.getMonth(), 1))

const title = computed(() =>
  month.value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
)
const WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
// Six rows from the Monday on or before the 1st.
const days = computed(() => {
  const m = month.value
  const lead = (m.getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(m.getFullYear(), m.getMonth(), i - lead + 1)
    return { iso: iso(d), n: d.getDate(), out: d.getMonth() !== m.getMonth() }
  })
})
function shift(n: number): void {
  const m = month.value
  month.value = new Date(m.getFullYear(), m.getMonth() + n, 1)
}
function pick(d: string): void {
  if (!from.value || to.value) {
    from.value = d
    to.value = ''
  } else if (d < from.value) {
    to.value = from.value
    from.value = d
  } else {
    to.value = d
  }
}
const ends = (d: string): boolean => d === from.value || d === to.value
const inside = (d: string): boolean => !!to.value && d > from.value && d < to.value
const short = (d: string): string =>
  new Date(`${d}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const summary = computed(() =>
  !from.value
    ? 'Pick a start day'
    : to.value
      ? `${short(from.value)} – ${short(to.value)}`
      : `${short(from.value)} – pick an end day`
)
</script>

<template>
  <div class="rc" @keydown.stop>
    <div class="rc-head">
      <span class="rc-title">{{ title }}</span>
      <button type="button" class="rc-nav" aria-label="Previous month" @click="shift(-1)">
        <ChevronLeft :size="15" />
      </button>
      <button type="button" class="rc-nav" aria-label="Next month" @click="shift(1)">
        <ChevronRight :size="15" />
      </button>
    </div>
    <div class="rc-grid" role="grid">
      <span v-for="w in WEEK" :key="w" class="rc-week">{{ w }}</span>
      <button
        v-for="d in days"
        :key="d.iso"
        type="button"
        :aria-label="d.iso"
        :aria-pressed="ends(d.iso)"
        :class="[
          'rc-day',
          d.out && 'is-out',
          ends(d.iso) && 'is-end',
          inside(d.iso) && 'is-in',
          d.iso === today && 'is-today'
        ]"
        @click="pick(d.iso)"
      >
        {{ d.n }}
      </button>
    </div>
    <p class="rc-sum">{{ summary }}</p>
  </div>
</template>

<style>
.rc {
  width: 236px;
  padding: 2px 4px 6px;
}
.rc-head {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 0 6px 6px;
}
.rc-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
}
:root .afm.afm.proto-ui.proto-ui .rc-nav {
  display: inline-flex;
  width: 26px;
  height: 26px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--color-muted-foreground);
}
:root .afm.afm.proto-ui.proto-ui .rc-nav:hover {
  background: var(--color-secondary-background);
  color: var(--color-base-foreground);
}
.rc-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  row-gap: 2px;
}
.rc-week {
  padding: 4px 0;
  color: var(--color-subtle-foreground);
  font-size: 11px;
  text-align: center;
}
:root .afm.afm.proto-ui.proto-ui .rc-day {
  height: 30px;
  padding: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--color-base-foreground);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
:root .afm.afm.proto-ui.proto-ui .rc-day:hover {
  background: var(--color-secondary-background);
}
:root .afm.afm.proto-ui.proto-ui .rc-day.is-out {
  color: var(--color-subtle-foreground);
}
:root .afm.afm.proto-ui.proto-ui .rc-day.is-today {
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}
:root .afm.afm.proto-ui.proto-ui .rc-day.is-in {
  border-radius: 0;
  background: color-mix(in oklch, var(--color-base-foreground) 8%, transparent);
}
:root .afm.afm.proto-ui.proto-ui .rc-day.is-end {
  background: var(--color-base-foreground);
  color: var(--color-content-background);
  font-weight: 600;
}
.rc-sum {
  padding: 8px 6px 0;
  color: var(--color-muted-foreground);
  font-size: 12px;
}
</style>
