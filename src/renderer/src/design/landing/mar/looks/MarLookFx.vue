<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ShaderMount,
  getShaderColorFromString,
  meshGradientFragmentShader
} from '@paper-design/shaders'
import { look } from '../../look'
import { lookOn } from './looks'
import MarLookHero from './MarLookHero.vue'

/**
 * The parts of a Look that CSS can't draw (looks.ts): a WebGL mesh
 * gradient behind the app (Liquid), the SVG filter Liquid's glass
 * refracts through, the pointer position Liquid lights its surfaces with,
 * and Netflix's hero (MarLookHero.vue). Mounted only while such a look is on; the
 * shader pauses off-screen (ShaderMount) and stands still with reduced
 * motion.
 */

const MESH: Record<string, { dark: string[]; light: string[]; grain: number; speed: number }> = {
  // Void's own greys, lighter and darker: light moves, the hue doesn't.
  liquid: {
    dark: ['#0b0b0d', '#1f1f23', '#151518', '#29292e', '#0e0e10'],
    light: ['#f3f3f5', '#e1e1e5', '#fbfbfc', '#e9e9ed', '#f0f0f2'],
    grain: 0,
    speed: 0.18
  }
}

const host = ref<HTMLDivElement>()
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
const mesh = computed(() => (lookOn.value ? MESH[lookOn.value] : undefined))
const tracks = computed(() => lookOn.value === 'liquid')
let shader: ShaderMount | undefined

watch(
  [host, mesh, () => look.theme],
  ([el, m, theme]) => {
    shader?.dispose()
    shader = undefined
    if (!el || !m) return
    const hex = theme === 'light' ? m.light : m.dark
    const colors = hex.map(getShaderColorFromString)
    // No WebGL (some VMs, headless): the same colours as a still CSS mesh.
    el.style.setProperty('--fx-a', hex[1]!)
    el.style.setProperty('--fx-b', hex[2]!)
    el.style.setProperty('--fx-c', hex[3]!)
    el.style.setProperty('--fx-base', hex[0]!)
    try {
      shader = new ShaderMount(
        el,
        meshGradientFragmentShader,
        {
          u_colors: colors,
          u_colorsCount: colors.length,
          u_distortion: 0.85,
          u_swirl: 0.55,
          u_grainMixer: m.grain * 0.6,
          u_grainOverlay: m.grain,
          u_fit: 2,
          u_scale: 1,
          u_rotation: 0,
          u_offsetX: 0,
          u_offsetY: 0,
          u_originX: 0.5,
          u_originY: 0.5,
          u_worldWidth: 0,
          u_worldHeight: 0
        },
        undefined,
        reduced.matches ? 0 : m.speed,
        // A fixed start frame: the same composition on every load.
        9000,
        // Soft gradients: 1x is plenty, and a third of the pixels.
        1,
        1920 * 1080
      )
      el.classList.remove('is-still')
    } catch {
      el.classList.add('is-still')
    }
  },
  { immediate: true, flush: 'post' }
)

// Pointer light: the viewport position on <html> (page-wide glow) and the
// position inside the surface under the pointer (its own highlight).
const LIT =
  '.edge-shine, .shadow-elev, .shadow-popover, .mar-prompt-slot > div, .proto-sidebar button, .proto-main button'
let raf = 0
let last: PointerEvent | undefined
function frame(): void {
  raf = 0
  const e = last
  if (!e) return
  const root = document.documentElement.style
  root.setProperty('--mar-px', `${e.clientX}px`)
  root.setProperty('--mar-py', `${e.clientY}px`)
  const el = (e.target as Element | null)?.closest?.(LIT) as HTMLElement | null
  if (!el) return
  const r = el.getBoundingClientRect()
  el.style.setProperty('--lx', `${e.clientX - r.left}px`)
  el.style.setProperty('--ly', `${e.clientY - r.top}px`)
  el.style.setProperty('--tx', `${((e.clientX - r.left) / r.width - 0.5).toFixed(3)}`)
  el.style.setProperty('--ty', `${((e.clientY - r.top) / r.height - 0.5).toFixed(3)}`)
}
function onMove(e: PointerEvent): void {
  last = e
  if (!raf) raf = requestAnimationFrame(frame)
}
watch(
  tracks,
  (on) => {
    if (on) window.addEventListener('pointermove', onMove, { passive: true })
    else window.removeEventListener('pointermove', onMove)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  shader?.dispose()
  window.removeEventListener('pointermove', onMove)
  cancelAnimationFrame(raf)
})
</script>

<template>
  <div v-if="mesh" ref="host" class="mar-look-fx" aria-hidden="true" />
  <MarLookHero v-if="lookOn === 'netflix'" />
  <!-- Liquid's refraction: glass panes use it as a backdrop filter. -->
  <svg v-if="lookOn === 'liquid'" class="mar-look-defs" aria-hidden="true" focusable="false">
    <filter id="mar-liquid-refract" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.006 0.009" numOctaves="2" seed="7" />
      <feGaussianBlur stdDeviation="2" result="map" />
      <feDisplacementMap
        in="SourceGraphic"
        in2="map"
        scale="14"
        xChannelSelector="R"
        yChannelSelector="G"
      />
    </filter>
  </svg>
</template>

<style>
.mar-look-fx {
  position: absolute;
  inset: 0;
  /* Under every sibling (shell, title bar, graph editor), above the
     window's own fill: looks.css isolates the parent. */
  z-index: -1;
  pointer-events: none;
}
.mar-look-fx.is-still {
  background:
    radial-gradient(60% 70% at 18% 20%, var(--fx-a), transparent 70%),
    radial-gradient(55% 60% at 85% 30%, var(--fx-b), transparent 70%),
    radial-gradient(70% 60% at 60% 95%, var(--fx-c), transparent 70%), var(--fx-base);
}
.mar-look-fx canvas {
  display: block;
}
.mar-look-defs {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}
</style>
