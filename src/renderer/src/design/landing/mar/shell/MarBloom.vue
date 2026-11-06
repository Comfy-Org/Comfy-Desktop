<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * Latent bloom (Home background): soft colour fields slowly resolve out of
 * film grain and dissolve back, like noise becoming an image. Diffusion as
 * a texture, so the page reads as Comfy without a logo or a gradient for
 * its own sake. Static under reduced motion; paused when the window is
 * hidden; about 30 frames a second.
 */
const canvas = ref<HTMLCanvasElement>()

// Muted plum, warm sand and a hint of Comfy yellow, at low alpha: a
// tint more than a colour, so the page stays neutral and the content leads.
const BLOBS = [
  { c: '118,96,140', x: 0.28, y: 0.42, r: 0.5, p: 0 },
  { c: '170,136,108', x: 0.72, y: 0.52, r: 0.45, p: 2 },
  { c: '196,200,150', x: 0.55, y: 0.26, r: 0.24, p: 4 }
]

let raf = 0
let timer: ReturnType<typeof setTimeout> | undefined
let t = 0

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

  const frame = (): void => {
    if (!still) t += 0.0025
    const k = (Math.sin(t) + 1) / 2
    x.clearRect(0, 0, w, h)
    x.save()
    x.filter = 'blur(72px)'
    for (const b of BLOBS) {
      const bx = w * (b.x + 0.06 * Math.sin(t * 0.7 + b.p))
      const by = h * (b.y + 0.08 * Math.cos(t * 0.5 + b.p))
      const g = x.createRadialGradient(bx, by, 0, bx, by, w * b.r)
      g.addColorStop(0, `rgba(${b.c},${0.2 + 0.1 * k})`)
      g.addColorStop(1, `rgba(${b.c},0)`)
      x.fillStyle = g
      x.fillRect(0, 0, w, h)
    }
    x.restore()
    // Grain: strongest while the colour is faint, fading as it "resolves".
    const amount = 0.08 * (1 - k) + 0.025
    for (let i = 0; i < noise.data.length; i += 4) {
      const v = Math.random() * 255
      noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = v
      noise.data[i + 3] = amount * 255
    }
    gx.putImageData(noise, 0, 0)
    // Fine film grain: a small tile repeated at its own size, never scaled.
    x.globalCompositeOperation = 'overlay'
    x.fillStyle = x.createPattern(grain, 'repeat')!
    x.fillRect(0, 0, w, h)
    x.globalCompositeOperation = 'source-over'
    if (still) return
    timer = setTimeout(() => {
      raf = requestAnimationFrame(frame)
    }, 33)
  }
  frame()
  // Size changes (and the first real layout) redraw; with reduced motion
  // that is the only frame drawn.
  const ro = new ResizeObserver(() => {
    fit()
    if (still) frame()
  })
  ro.observe(c)

  const onVisible = (): void => {
    if (document.hidden) {
      clearTimeout(timer)
      cancelAnimationFrame(raf)
    } else if (!still) frame()
  }
  document.addEventListener('visibilitychange', onVisible)
  onBeforeUnmount(() => {
    ro.disconnect()
    document.removeEventListener('visibilitychange', onVisible)
  })
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  cancelAnimationFrame(raf)
})
</script>

<template>
  <canvas ref="canvas" class="mar-bloom" aria-hidden="true" />
</template>

<style scoped>
.mar-bloom {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
