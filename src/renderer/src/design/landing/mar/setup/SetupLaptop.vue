<script setup lang="ts">
import type { SetupOs } from './setupFlow'

/**
 * The detected machine, drawn from the front in one style per computer: a
 * Mac laptop (aluminium, notch), a Windows laptop (graphite, camera dot,
 * squarer) or a Linux workstation's display on its stand. Sized by its
 * `.mss-laptop` box; `bad` dims the screen and rings it in danger for
 * hardware that can't run ComfyUI.
 */
const { bad = false, os = 'mac' } = defineProps<{ bad?: boolean; os?: SetupOs }>()
</script>

<template>
  <svg
    class="mss-laptop"
    :class="bad && 'is-bad'"
    viewBox="0 0 160 104"
    fill="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="mss-lt-edge" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8a8a90" />
        <stop offset="1" stop-color="#3a3a3e" />
      </linearGradient>
      <linearGradient id="mss-lt-base" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#e4e4e8" />
        <stop offset="0.35" stop-color="#a9a9af" />
        <stop offset="1" stop-color="#5b5b61" />
      </linearGradient>
      <linearGradient id="mss-lt-screen" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#3a3a3e" />
        <stop offset="0.55" stop-color="#1f1f22" />
        <stop offset="1" stop-color="#0e0e10" />
      </linearGradient>
      <radialGradient id="mss-lt-glow" cx="0.28" cy="0.2" r="0.75">
        <stop offset="0" stop-color="#fff" stop-opacity="0.22" />
        <stop offset="0.5" stop-color="#fff" stop-opacity="0.06" />
        <stop offset="1" stop-color="#fff" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="mss-lt-sheen" x1="0" y1="0" x2="1" y2="0.6">
        <stop offset="0" stop-color="#fff" stop-opacity="0.14" />
        <stop offset="0.45" stop-color="#fff" stop-opacity="0.03" />
        <stop offset="0.46" stop-color="#fff" stop-opacity="0" />
      </linearGradient>
      <radialGradient id="mss-lt-shadow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#000" stop-opacity="0.55" />
        <stop offset="1" stop-color="#000" stop-opacity="0" />
      </radialGradient>
      <clipPath id="mss-lt-clip"><rect x="22.5" y="8.5" width="115" height="72" rx="3" /></clipPath>
      <linearGradient id="mss-lt-edge-pc" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#5a5a60" />
        <stop offset="1" stop-color="#232326" />
      </linearGradient>
      <linearGradient id="mss-lt-base-pc" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6c6c73" />
        <stop offset="0.35" stop-color="#3f3f45" />
        <stop offset="1" stop-color="#1c1c1f" />
      </linearGradient>
      <clipPath id="mss-lt-clip-pc">
        <rect x="21.5" y="8" width="117" height="73" rx="1.5" />
      </clipPath>
      <clipPath id="mss-lt-clip-dt">
        <rect x="15.5" y="6.5" width="129" height="68" rx="2" />
      </clipPath>
    </defs>

    <!-- Windows: a graphite laptop, squarer, a camera dot in the bezel. -->
    <template v-if="os === 'windows'">
      <ellipse cx="80" cy="97" rx="76" ry="6" fill="url(#mss-lt-shadow)" />
      <rect x="18" y="4" width="124" height="83" rx="4.5" fill="url(#mss-lt-edge-pc)" />
      <rect x="19" y="5" width="122" height="82" rx="3.5" fill="#09090b" />
      <g clip-path="url(#mss-lt-clip-pc)">
        <rect
          class="mss-laptop-screen"
          x="21.5"
          y="8"
          width="117"
          height="73"
          fill="url(#mss-lt-screen)"
        />
        <rect
          class="mss-laptop-glow"
          x="21.5"
          y="8"
          width="117"
          height="73"
          fill="url(#mss-lt-glow)"
        />
        <rect x="21.5" y="8" width="117" height="73" fill="url(#mss-lt-sheen)" />
      </g>
      <circle cx="80" cy="6.5" r="0.8" fill="#3a3a40" />
      <rect
        class="mss-laptop-ring"
        x="21.5"
        y="8"
        width="117"
        height="73"
        rx="1.5"
        stroke="#fff"
        stroke-opacity="0.06"
      />
      <path
        d="M5 87h150v3c0 2.8-3.4 5-7.6 5H12.6C8.4 95 5 92.8 5 90z"
        fill="url(#mss-lt-base-pc)"
      />
      <rect x="5" y="87" width="150" height="0.9" fill="#fff" fill-opacity="0.28" />
      <rect x="60" y="87.9" width="40" height="1.4" rx="0.7" fill="#141416" />
    </template>

    <!-- Linux: a workstation's display on its stand. -->
    <template v-else-if="os === 'linux'">
      <ellipse cx="80" cy="98" rx="52" ry="5" fill="url(#mss-lt-shadow)" />
      <path d="M72 80h16l2 13H70z" fill="url(#mss-lt-base-pc)" />
      <rect x="54" y="92" width="52" height="3.5" rx="1.75" fill="url(#mss-lt-base-pc)" />
      <rect x="54" y="92" width="52" height="0.8" rx="0.4" fill="#fff" fill-opacity="0.28" />
      <rect x="12" y="3" width="136" height="78" rx="4.5" fill="url(#mss-lt-edge-pc)" />
      <rect x="13" y="4" width="134" height="76" rx="3.5" fill="#09090b" />
      <g clip-path="url(#mss-lt-clip-dt)">
        <rect
          class="mss-laptop-screen"
          x="15.5"
          y="6.5"
          width="129"
          height="68"
          fill="url(#mss-lt-screen)"
        />
        <rect
          class="mss-laptop-glow"
          x="15.5"
          y="6.5"
          width="129"
          height="68"
          fill="url(#mss-lt-glow)"
        />
        <rect x="15.5" y="6.5" width="129" height="68" fill="url(#mss-lt-sheen)" />
      </g>
      <rect
        class="mss-laptop-ring"
        x="15.5"
        y="6.5"
        width="129"
        height="68"
        rx="2"
        stroke="#fff"
        stroke-opacity="0.06"
      />
      <circle cx="80" cy="77.2" r="0.8" fill="#3a3a40" />
    </template>

    <template v-else>
      <ellipse cx="80" cy="97" rx="76" ry="6" fill="url(#mss-lt-shadow)" />

      <!-- Lid: aluminium edge, black bezel, the display with its notch. -->
      <rect x="18" y="4" width="124" height="83" rx="7.5" fill="url(#mss-lt-edge)" />
      <rect x="19" y="5" width="122" height="82" rx="6.5" fill="#09090b" />
      <g clip-path="url(#mss-lt-clip)">
        <rect
          class="mss-laptop-screen"
          x="22.5"
          y="8.5"
          width="115"
          height="72"
          fill="url(#mss-lt-screen)"
        />
        <rect
          class="mss-laptop-glow"
          x="22.5"
          y="8.5"
          width="115"
          height="72"
          fill="url(#mss-lt-glow)"
        />
        <rect x="22.5" y="8.5" width="115" height="72" fill="url(#mss-lt-sheen)" />
      </g>
      <path d="M72 8.5h16v2.2a1.8 1.8 0 0 1-1.8 1.8H73.8a1.8 1.8 0 0 1-1.8-1.8z" fill="#09090b" />
      <rect
        class="mss-laptop-ring"
        x="22.5"
        y="8.5"
        width="115"
        height="72"
        rx="3"
        stroke="#fff"
        stroke-opacity="0.06"
      />

      <!-- Base: the deck's front edge, with the lid's thumb scoop. -->
      <path
        d="M3 87h154v2.5c0 3-4.5 5.5-10 5.5H13C7.5 95 3 92.5 3 89.5z"
        fill="url(#mss-lt-base)"
      />
      <rect x="3" y="87" width="154" height="0.9" fill="#fff" fill-opacity="0.55" />
      <path d="M67 87h26v0.8a2.4 2.4 0 0 1-2.4 2.4H69.4a2.4 2.4 0 0 1-2.4-2.4z" fill="#4a4a50" />
    </template>
  </svg>
</template>
