<script setup lang="ts">
/**
 * Recent activity as milestones on a vertical line (Mar's proposal), the
 * Timeline idea from the Proposals · 20 Home: when on the left, a dot on one rail,
 * who did what on the right. The rail runs from the first dot to the last.
 */
defineProps<{ items: { who: string; what: string; when: string }[] }>()
</script>

<template>
  <ol class="mar-tl">
    <li v-for="(a, i) in items" :key="i" class="mar-tl-row">
      <span class="mar-tl-when">{{ a.when }}</span>
      <span class="mar-tl-rail" aria-hidden="true"
        ><i class="mar-tl-dot" :class="i === 0 && 'is-latest'"
      /></span>
      <span class="mar-tl-what">
        <span class="font-medium text-base-foreground">{{ a.who }}</span>
        <span class="ml-1 text-muted-foreground">{{ a.what }}</span>
      </span>
    </li>
  </ol>
</template>

<style scoped>
.mar-tl {
  display: flex;
  flex-direction: column;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}
.mar-tl-row {
  display: grid;
  grid-template-columns: 88px 20px 1fr;
  align-items: start;
  gap: 10px;
  min-height: 40px;
  font-size: var(--text-ui, 13px);
  line-height: 20px;
}
.mar-tl-when {
  color: var(--color-subtle-foreground);
  font-size: 12px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.mar-tl-rail {
  position: relative;
  align-self: stretch;
  display: flex;
  justify-content: center;
}
/* The line runs from this row's dot to the next one. */
.mar-tl-rail::before {
  content: '';
  position: absolute;
  top: 10px;
  bottom: -10px;
  left: 50%;
  width: 1px;
  translate: -0.5px 0;
  background: color-mix(in oklch, var(--color-base-foreground) 16%, transparent);
}
.mar-tl-row:last-child .mar-tl-rail::before {
  display: none;
}
.mar-tl-dot {
  position: relative;
  width: 7px;
  height: 7px;
  margin-top: 7px;
  border-radius: 999px;
  background: var(--color-subtle-foreground);
  box-shadow: 0 0 0 4px var(--color-card-background);
}
.mar-tl-dot.is-latest {
  background: var(--color-base-foreground);
}
.mar-tl-what {
  padding-bottom: 12px;
}
</style>
