<script setup lang="ts">
/**
 * The detected machine, drawn: a laptop seen from the front, lid open. Sized
 * by its `.mss-laptop` box; `bad` dims the screen and rings it in danger for
 * hardware that can't run ComfyUI.
 */
const { bad = false } = defineProps<{ bad?: boolean }>()
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
    </defs>

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
    <path d="M3 87h154v2.5c0 3-4.5 5.5-10 5.5H13C7.5 95 3 92.5 3 89.5z" fill="url(#mss-lt-base)" />
    <rect x="3" y="87" width="154" height="0.9" fill="#fff" fill-opacity="0.55" />
    <path d="M67 87h26v0.8a2.4 2.4 0 0 1-2.4 2.4H69.4a2.4 2.4 0 0 1-2.4-2.4z" fill="#4a4a50" />
  </svg>
</template>
