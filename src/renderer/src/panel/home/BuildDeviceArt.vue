<script setup lang="ts">
import { useId } from 'vue'

const { kind, glow } = defineProps<{
  kind: 'laptop' | 'cloud'
  glow: string
}>()

const CLOUD_PATH =
  'M26.46 44.94h37.27a9.33 9.33 0 0 0 1.1-18.63 15.26 15.26 0 0 0-28.5-5.48 11.1 11.1 0 0 0-12.06 6.57 8.83 8.83 0 0 0 2.19 17.54Z'

const id = useId()
</script>

<template>
  <svg
    v-if="kind === 'laptop'"
    width="88"
    height="57"
    viewBox="0 0 88 57"
    fill="none"
    aria-hidden="true"
  >
    <ellipse cx="44" cy="53.16" rx="41.65" ry="3.29" :fill="`url(#${id}-ground)`" />
    <rect x="10.02" y="2.19" width="67.96" height="45.49" rx="4.11" :fill="`url(#${id}-lid)`" />
    <rect x="10.57" y="2.74" width="66.87" height="44.94" rx="3.56" fill="#0A0A0A" />
    <rect x="12.49" y="4.66" width="63.03" height="39.46" rx="1.64" :fill="`url(#${id}-screen)`" />
    <rect x="12.49" y="4.66" width="63.03" height="39.46" rx="1.64" :fill="`url(#${id}-glow)`" />
    <rect x="12.49" y="4.66" width="63.03" height="39.46" rx="1.64" :fill="`url(#${id}-sheen)`" />
    <path
      d="M39.62 4.66h8.76v1.2a.99.99 0 0 1-.98.99h-6.8a.99.99 0 0 1-.98-.99v-1.2Z"
      fill="#0A0A0A"
    />
    <rect
      x="12.49"
      y="4.66"
      width="63.03"
      height="39.46"
      rx="1.64"
      stroke="white"
      stroke-opacity="0.06"
      stroke-width="0.55"
    />
    <path
      d="M1.8 47.68h84.4v1.37c0 1.65-2.46 3.02-5.48 3.02H7.28c-3.02 0-5.48-1.37-5.48-3.02v-1.37Z"
      :fill="`url(#${id}-base)`"
    />
    <rect x="1.8" y="47.68" width="84.4" height="0.49" fill="white" fill-opacity="0.55" />
    <path
      d="M36.88 47.68h14.24v.44a1.32 1.32 0 0 1-1.31 1.32H38.19a1.32 1.32 0 0 1-1.31-1.32v-.44Z"
      fill="#4A4A50"
    />
    <defs>
      <radialGradient :id="`${id}-ground`">
        <stop stop-opacity="0.55" />
        <stop offset="1" stop-opacity="0" />
      </radialGradient>
      <linearGradient :id="`${id}-lid`" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="#8A8A90" />
        <stop offset="1" stop-color="#3A3A3E" />
      </linearGradient>
      <linearGradient :id="`${id}-screen`" x1="0" y1="0" x2="0.56" y2="1.44">
        <stop stop-color="#3A3A3E" />
        <stop offset="0.55" stop-color="#1F1F22" />
        <stop offset="1" stop-color="#0E0E10" />
      </linearGradient>
      <radialGradient :id="`${id}-glow`" cx="0.33" cy="0.36" r="0.75">
        <stop :stop-color="glow" stop-opacity="0.8" />
        <stop offset="0.65" :stop-color="glow" stop-opacity="0.3" />
        <stop offset="1" :stop-color="glow" stop-opacity="0" />
      </radialGradient>
      <linearGradient :id="`${id}-sheen`" x1="0" y1="0" x2="0.71" y2="1.09">
        <stop stop-color="white" stop-opacity="0.14" />
        <stop offset="0.45" stop-color="white" stop-opacity="0.03" />
        <stop offset="0.46" stop-color="white" stop-opacity="0" />
      </linearGradient>
      <linearGradient :id="`${id}-base`" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="#E4E4E8" />
        <stop offset="0.35" stop-color="#A9A9AF" />
        <stop offset="1" stop-color="#5B5B61" />
      </linearGradient>
    </defs>
  </svg>
  <svg v-else width="88" height="57" viewBox="0 0 88 57" fill="none" aria-hidden="true">
    <ellipse cx="45.1" cy="51.52" rx="25.21" ry="2.74" :fill="`url(#${id}-ground)`" />
    <path :id="`${id}-cloud`" :d="CLOUD_PATH" :fill="`url(#${id}-body)`" />
    <use :href="`#${id}-cloud`" :fill="`url(#${id}-glow)`" />
    <use
      :href="`#${id}-cloud`"
      fill="none"
      stroke="white"
      stroke-opacity="0.18"
      stroke-width="0.55"
    />
    <defs>
      <radialGradient :id="`${id}-ground`">
        <stop stop-opacity="0.55" />
        <stop offset="1" stop-opacity="0" />
      </radialGradient>
      <linearGradient :id="`${id}-body`" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="#9A9AA0" />
        <stop offset="0.55" stop-color="#55555B" />
        <stop offset="1" stop-color="#2A2A2E" />
      </linearGradient>
      <radialGradient :id="`${id}-glow`" cx="0.45" cy="0.7" r="0.6">
        <stop :stop-color="glow" stop-opacity="0.55" />
        <stop offset="1" :stop-color="glow" stop-opacity="0" />
      </radialGradient>
    </defs>
  </svg>
</template>
