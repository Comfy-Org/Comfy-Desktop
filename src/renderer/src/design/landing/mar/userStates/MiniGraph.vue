<script setup lang="ts">
/**
 * A small ComfyUI graph for the node editor entry: Load Image, KSampler and
 * Save Image on a dot grid, always shown whole, wired with ComfyUI's link colours. `bare`
 * drops the node titles for thumbnail sizes.
 */
const { bare = false } = defineProps<{ bare?: boolean }>()
const uid = `mg-${Math.random().toString(36).slice(2, 8)}`
</script>

<template>
  <div class="mar-mg" aria-hidden="true">
    <svg viewBox="0 0 300 150" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient :id="`${uid}-img`" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#f4b183" />
          <stop offset="1" stop-color="#8e5ea2" />
        </linearGradient>
        <linearGradient :id="`${uid}-out`" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#7ec8e3" />
          <stop offset="1" stop-color="#3b5bdb" />
        </linearGradient>
      </defs>

      <!-- Links: IMAGE blue, MODEL purple, LATENT pink. -->
      <path d="M100 58 C 108 58, 104 50, 114 50" class="mar-mg-link" stroke="#64b5f6" />
      <path d="M100 76 C 108 76, 104 66, 114 66" class="mar-mg-link" stroke="#b39ddb" />
      <path d="M196 54 C 204 54, 200 62, 208 62" class="mar-mg-link" stroke="#ff9cf9" />

      <!-- Load Image -->
      <g transform="translate(16 32)">
        <rect width="84" height="80" rx="6" class="mar-mg-node" />
        <path d="M0 6a6 6 0 0 1 6-6h72a6 6 0 0 1 6 6v10H0z" class="mar-mg-head" />
        <text v-if="!bare" x="7" y="11" class="mar-mg-title">Load Image</text>
        <rect x="7" y="22" width="56" height="50" rx="3" :fill="`url(#${uid}-img)`" />
        <circle cx="84" cy="26" r="3" fill="#64b5f6" />
        <circle cx="84" cy="44" r="3" fill="#b39ddb" />
      </g>

      <!-- KSampler -->
      <g transform="translate(114 22)">
        <rect width="82" height="100" rx="6" class="mar-mg-node is-active" />
        <path d="M0 6a6 6 0 0 1 6-6h70a6 6 0 0 1 6 6v10H0z" class="mar-mg-head" />
        <text v-if="!bare" x="7" y="11" class="mar-mg-title">KSampler</text>
        <circle cx="0" cy="28" r="3" fill="#64b5f6" />
        <circle cx="0" cy="44" r="3" fill="#b39ddb" />
        <circle cx="82" cy="32" r="3" fill="#ff9cf9" />
        <rect x="9" y="56" width="64" height="8" rx="4" class="mar-mg-widget" />
        <rect x="9" y="68" width="64" height="8" rx="4" class="mar-mg-widget" />
        <rect x="9" y="80" width="40" height="8" rx="4" class="mar-mg-widget" />
        <rect x="9" y="80" width="26" height="8" rx="4" class="mar-mg-fill" />
      </g>

      <!-- Save Image -->
      <g transform="translate(208 40)">
        <rect width="80" height="80" rx="6" class="mar-mg-node" />
        <path d="M0 6a6 6 0 0 1 6-6h68a6 6 0 0 1 6 6v10H0z" class="mar-mg-head" />
        <text v-if="!bare" x="7" y="11" class="mar-mg-title">Save Image</text>
        <circle cx="0" cy="22" r="3" fill="#ff9cf9" />
        <rect x="8" y="22" width="64" height="50" rx="3" :fill="`url(#${uid}-out)`" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.mar-mg {
  --mg-node: #29292c;
  --mg-head: #38383c;
  --mg-dot: rgb(255 255 255 / 0.14);
  --mg-text: rgb(255 255 255 / 0.72);
  --mg-widget: rgb(255 255 255 / 0.08);
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  padding: 8px;
  background-image: radial-gradient(circle, var(--mg-dot) 0.8px, transparent 1px);
  background-size: 12px 12px;
}
.mar-mg > svg {
  width: 100%;
  height: 100%;
}
:global(:root[data-ds-theme='light'] .mar-mg) {
  --mg-node: #ffffff;
  --mg-head: #f0f0f2;
  --mg-dot: rgb(0 0 0 / 0.12);
  --mg-text: rgb(0 0 0 / 0.62);
  --mg-widget: rgb(0 0 0 / 0.06);
}
.mar-mg-node {
  fill: var(--mg-node);
  stroke: rgb(0 0 0 / 0.25);
  stroke-width: 0.5;
  filter: drop-shadow(0 4px 8px rgb(0 0 0 / 0.25));
}
:global(:root[data-ds-theme='light'] .mar-mg-node) {
  stroke: rgb(0 0 0 / 0.08);
  filter: drop-shadow(0 4px 8px rgb(0 0 0 / 0.08));
}
.mar-mg-node.is-active {
  stroke: #ffffff;
  stroke-opacity: 0.55;
  stroke-width: 1;
}
:global(:root[data-ds-theme='light'] .mar-mg-node.is-active) {
  stroke: #3b82f6;
  stroke-opacity: 0.7;
}
.mar-mg-head {
  fill: var(--mg-head);
}
.mar-mg-title {
  fill: var(--mg-text);
  font-size: 7px;
  font-weight: 600;
  font-family: inherit;
}
.mar-mg-widget {
  fill: var(--mg-widget);
}
.mar-mg-fill {
  fill: #3b82f6;
  opacity: 0.7;
}
.mar-mg-link {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
}
</style>
