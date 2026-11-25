<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

/**
 * The setup stage: the Home's latent bloom (shell/MarBloom.vue) as the
 * backdrop of the local setup. Colour fields drift in film grain; while it
 * installs, `resolve` (0 to 1) brings the picked workflow's image out of
 * the noise, so the wait shows what it is building toward. `tone` tints it
 * red when the install stops. Static under reduced motion; paused when the
 * window is hidden; about 30 frames a second.
 */
const props = withDefaults(
  defineProps<{ resolve?: number; src?: string; tone?: 'idle' | 'err' }>(),
  { resolve: 0, src: undefined, tone: 'idle' }
)

const canvas = ref<HTMLCanvasElement>()

// Mar's bloom palette (plum, sand, a hint of Comfy yellow), stronger here:
// the stage is a picture, not a page tint.
const IDLE = [
  { c: '150,98,210', x: 0.2, y: 0.6, r: 0.5, p: 0 },
  { c: '232,146,108', x: 0.78, y: 0.55, r: 0.45, p: 2 },
  { c: '222,236,120', x: 0.55, y: 0.05, r: 0.26, p: 4 }
]
const ERR = [
  { c: '170,70,74', x: 0.3, y: 0.5, r: 0.55, p: 0 },
  { c: '120,72,96', x: 0.72, y: 0.5, r: 0.5, p: 2 },
  { c: '190,120,100', x: 0.52, y: 0.2, r: 0.28, p: 4 }
]

let raf = 0
let timer: ReturnType<typeof setTimeout> | undefined
let t = 0
let img: HTMLImageElement | undefined
let draw: (() => void) | undefined

function load(src?: string): void {
  if (!src) {
    img = undefined
    draw?.()
    return
  }
  const next = new Image()
  next.onload = () => {
    if (props.src === src) {
      img = next
      draw?.()
    }
  }
  next.src = src
}

onMounted(() => {
  const c = canvas.value!
  const x = c.getContext('2d')!
  const grain = document.createElement('canvas')
  grain.width = 128
  grain.height = 128
  const gx = grain.getContext('2d')!
  const noise = gx.createImageData(128, 128)
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  let w = 0
  let h = 0
  const fit = (): void => {
    const r = c.getBoundingClientRect()
    const d = Math.min(window.devicePixelRatio || 1, 2)
    w = r.width
    h = r.height
    c.width = Math.round(w * d)
    c.height = Math.round(h * d)
    x.setTransform(d, 0, 0, d, 0, 0)
  }
  fit()

  draw = (): void => {
    const k = (Math.sin(t) + 1) / 2
    const r = Math.min(1, Math.max(0, props.resolve))
    x.clearRect(0, 0, w, h)

    // The picked image, out of focus and faint at first, sharp at the end.
    if (img && props.tone === 'idle') {
      const s = Math.max(w / img.width, h / img.height)
      const iw = img.width * s
      const ih = img.height * s
      x.save()
      x.globalAlpha = 0.2 + 0.8 * r
      x.filter = `blur(${Math.round((1 - r) * 28)}px) saturate(${0.6 + 0.4 * r})`
      x.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih)
      x.restore()
    }

    // Colour fields: fade back as the image takes over.
    x.save()
    x.filter = 'blur(56px)'
    const fields = props.tone === 'err' ? ERR : IDLE
    const strength = img && props.tone === 'idle' ? 1 - 0.75 * r : 1
    for (const b of fields) {
      const bx = w * (b.x + 0.06 * Math.sin(t * 0.7 + b.p))
      const by = h * (b.y + 0.1 * Math.cos(t * 0.5 + b.p))
      const g = x.createRadialGradient(bx, by, 0, bx, by, w * b.r)
      g.addColorStop(0, `rgba(${b.c},${(0.5 + 0.15 * k) * strength})`)
      g.addColorStop(1, `rgba(${b.c},0)`)
      x.fillStyle = g
      x.fillRect(0, 0, w, h)
    }
    x.restore()

    // Grain: a fine film, a little stronger while it is still noise. Drawn
    // at device pixels so it stays one pixel fine on retina, not blocky.
    const amount = 0.05 * (1 - r) + 0.02
    for (let i = 0; i < noise.data.length; i += 4) {
      const v = Math.random() * 255
      noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = v
      noise.data[i + 3] = amount * 255
    }
    gx.putImageData(noise, 0, 0)
    x.save()
    x.setTransform(1, 0, 0, 1, 0, 0)
    x.globalCompositeOperation = 'overlay'
    x.fillStyle = x.createPattern(grain, 'repeat')!
    x.fillRect(0, 0, c.width, c.height)
    x.restore()
  }

  const frame = (): void => {
    t += 0.004
    draw!()
    timer = setTimeout(() => {
      raf = requestAnimationFrame(frame)
    }, 33)
  }
  if (still) draw()
  else frame()

  const ro = new ResizeObserver(() => {
    fit()
    draw!()
  })
  ro.observe(c)

  const onVisible = (): void => {
    clearTimeout(timer)
    cancelAnimationFrame(raf)
    if (!document.hidden && !still) frame()
  }
  document.addEventListener('visibilitychange', onVisible)
  onBeforeUnmount(() => {
    ro.disconnect()
    document.removeEventListener('visibilitychange', onVisible)
  })

  load(props.src)
})

watch(
  () => props.src,
  (src) => load(src)
)
// Reduced motion draws only on change: keep the still frame current.
watch(
  () => [props.resolve, props.tone],
  () => draw?.()
)

onBeforeUnmount(() => {
  clearTimeout(timer)
  cancelAnimationFrame(raf)
  draw = undefined
})
</script>

<template>
  <canvas ref="canvas" class="block size-full" aria-hidden="true" />
</template>
