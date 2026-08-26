import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import type { BrandScene, Keyframe, Scene } from '../lib/brandScene/types'

/**
 * Drives the install-wait scene: masked <video> layers positioned by keyframed
 * CSS transforms on one rAF loop. The caller owns the DOM; we drive geometry
 * and playback off the stage ref.
 */

interface SceneRuntime {
  el: HTMLElement
  videos: HTMLVideoElement[]
  activeIdx: number
  scene: Scene
}

/** Cubic-bezier easing y(x) for x in [0,1]; identity when degenerate. */
export function makeBezier(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number
): (x: number) => number {
  const cx = 3 * p1x
  const bx = 3 * (p2x - p1x) - cx
  const ax = 1 - cx - bx
  const cy = 3 * p1y
  const by = 3 * (p2y - p1y) - cy
  const ay = 1 - cy - by
  const f = (t: number, a: number, b: number, c: number) => ((a * t + b) * t + c) * t
  const fp = (t: number, a: number, b: number, c: number) => (3 * a * t + 2 * b) * t + c
  return (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const xt = f(t, ax, bx, cx) - x
      if (Math.abs(xt) < 1e-5) break
      const d = fp(t, ax, bx, cx)
      if (Math.abs(d) < 1e-6) break
      t -= xt / d
    }
    return f(Math.max(0, Math.min(1, t)), ay, by, cy)
  }
}

/** Cache the per-segment easer on the keyframe so it's built once. */
type CachedKf = Keyframe & { _easer?: (x: number) => number }

type Vec2 = [number, number]

const vec2 = (v: readonly number[]): Vec2 => [v[0] ?? 0, v[1] ?? 0]

/** Interpolate a keyframe track to its first two components at frame `t`. */
export function lerpKf(kfs: CachedKf[], t: number): Vec2 {
  if (kfs.length === 0) return [0, 0]
  const first = kfs[0]
  const last = kfs[kfs.length - 1]
  if (!first || !last) return [0, 0]
  if (kfs.length === 1 || t <= first.t) return vec2(first.v)
  if (t >= last.t) return vec2(last.v)

  let i = 0
  while (i < kfs.length - 1 && (kfs[i + 1]?.t ?? Infinity) <= t) i++
  const a = kfs[i]
  const b = kfs[i + 1]
  if (!a || !b) return vec2(first.v)
  const span = b.t - a.t
  if (span <= 0) return vec2(a.v)

  const x = (t - a.t) / span
  let eased = x
  if (a.eo && b.ei) {
    if (!a._easer) a._easer = makeBezier(a.eo[0], a.eo[1], b.ei[0], b.ei[1])
    eased = a._easer(x)
  }
  const [ax, ay] = vec2(a.v)
  const [bx, by] = vec2(b.v)
  return [ax + (bx - ax) * eased, ay + (by - ay) * eased]
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface BrandSceneOptions {
  fit?: 'contain' | 'cover'
  /** Timeline rate; below 1 slows the loop. */
  speed?: number
}

export function useBrandScene(
  stageRef: Ref<HTMLElement | null>,
  data: BrandScene,
  options: BrandSceneOptions = {}
) {
  const COMP_W = data.compW
  const COMP_H = data.compH
  const FPS = data.fps
  const DURATION = data.duration
  const FIT = options.fit ?? 'contain'
  const SPEED = options.speed ?? 0.55

  const runtimes: SceneRuntime[] = []
  let masterFrame = 0
  let startEpoch = 0
  let lastTickFrame = -1
  let rafId = 0
  let playing = false
  const reduced = ref(prefersReducedMotion())

  type RvfcVideo = HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number
  }

  /** Fade a just-activated clip in only once a decoded frame exists — a clip
   *  pinned off frame 0 seeks away from the preloaded frame, so revealing sooner
   *  shows the mask ground. rVFC is authoritative (fires on a composited frame);
   *  the fallback gates on `readyState >= HAVE_CURRENT_DATA`, never a bare timer.
   *  Sticky once painted. */
  function markPaintedWhenReady(ve: HTMLVideoElement): void {
    if (ve.classList.contains('is-painted')) return
    const cleanup: Array<() => void> = []
    let done = false
    const paint = (): void => {
      if (done) return
      done = true
      ve.classList.add('is-painted')
      for (const c of cleanup) c()
    }

    const rvfc = (ve as RvfcVideo).requestVideoFrameCallback
    if (typeof rvfc === 'function') {
      rvfc.call(ve, paint)
      return
    }

    const tryPaint = (): void => {
      if (ve.readyState >= 2 /* HAVE_CURRENT_DATA */) paint()
    }
    for (const ev of ['seeked', 'loadeddata', 'canplay', 'timeupdate']) {
      ve.addEventListener(ev, tryPaint)
      cleanup.push(() => ve.removeEventListener(ev, tryPaint))
    }
    tryPaint()
  }

  /** Scale the comp-sized stage to its wrapper (contain fits, cover crops). */
  function fitStage(): void {
    const stage = stageRef.value
    const wrap = stage?.parentElement
    if (!stage || !wrap) return
    const sx = wrap.clientWidth / COMP_W
    const sy = wrap.clientHeight / COMP_H
    const s = FIT === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy)
    stage.style.transform = `scale(${s})`
  }

  /** Collect the .brand-scene / <video> DOM the template rendered. */
  function collectRuntimes(): void {
    runtimes.length = 0
    const stage = stageRef.value
    if (!stage) return
    const sceneEls = Array.from(stage.querySelectorAll<HTMLElement>('.brand-scene'))
    data.scenes.forEach((scene, i) => {
      const el = sceneEls[i]
      if (!el) return
      const videos = Array.from(el.querySelectorAll<HTMLVideoElement>('video'))
      runtimes.push({ el, videos, activeIdx: -1, scene })
    })
  }

  /** Position every scene and its active video for the current master frame. */
  function render(): void {
    for (const s of runtimes) {
      const scene = s.scene
      const pt = masterFrame - scene.outerSt

      const [ox, oy] = lerpKf(scene.outerPos, masterFrame)
      const dx = ox - 528
      const dy = oy - 392

      const [mpx, mpy] = lerpKf(scene.maskPos, pt)
      const [mw, mh] = lerpKf(scene.maskSize, pt)
      const grp = scene.maskGroupOffset
      const cx = mpx + grp[0] + dx
      const cy = mpy + grp[1] + dy

      s.el.style.transform = `translate(${cx - mw / 2}px, ${cy - mh / 2}px)`
      s.el.style.width = `${mw}px`
      s.el.style.height = `${mh}px`

      let activeIdx = -1
      for (let i = 0; i < scene.videos.length; i++) {
        const v = scene.videos[i]
        if (v && pt >= v.ip && pt < v.op) {
          activeIdx = i
          break
        }
      }

      if (activeIdx !== s.activeIdx) {
        for (const ve of s.videos) {
          ve.classList.remove('is-active')
          ve.pause()
        }
        const v = activeIdx >= 0 ? scene.videos[activeIdx] : undefined
        const ve = activeIdx >= 0 ? s.videos[activeIdx] : undefined
        if (v && ve) {
          const sourceTime = (pt - v.st) / FPS
          const safe = Math.max(0, Math.min(sourceTime, (ve.duration || 60) - 0.001))
          try {
            ve.currentTime = safe
          } catch {
            /* seek before metadata; corrected on the next active switch */
          }
          ve.classList.add('is-active')
          markPaintedWhenReady(ve)
          if (playing) void ve.play().catch(() => {})
        }
        s.activeIdx = activeIdx
      }

      const v = activeIdx >= 0 ? scene.videos[activeIdx] : undefined
      const ve = activeIdx >= 0 ? s.videos[activeIdx] : undefined
      if (v && ve) {
        const [scx, scy] = lerpKf(v.scale, pt)
        const [vpx, vpy] = lerpKf(v.pos, pt)
        const sxF = scx / 100
        const syF = scy / 100
        const anchorXInMask = vpx - grp[0] + mw / 2
        const anchorYInMask = vpy - grp[1] + mh / 2
        ve.style.width = `${COMP_W * sxF}px`
        ve.style.height = `${COMP_H * syF}px`
        ve.style.transform = `translate(${anchorXInMask - sxF * 528}px, ${anchorYInMask - syF * 392}px)`
      }
    }
  }

  function tick(now: number): void {
    if (playing) {
      masterFrame = ((now - startEpoch) / 1000) * FPS * SPEED
      if (masterFrame >= DURATION) {
        masterFrame = 0
        startEpoch = now
        for (const s of runtimes) s.activeIdx = -2
      }
    }
    const frame = Math.floor(masterFrame)
    if (frame !== lastTickFrame) {
      render()
      lastTickFrame = frame
    }
    rafId = playing ? requestAnimationFrame(tick) : 0
  }

  function play(): void {
    if (reduced.value || playing) return
    startEpoch = performance.now() - (masterFrame / FPS / SPEED) * 1000
    playing = true
    for (const s of runtimes) {
      for (const v of s.videos) {
        if (v.classList.contains('is-active')) void v.play().catch(() => {})
      }
    }
    if (!rafId) rafId = requestAnimationFrame(tick)
  }

  function pause(): void {
    playing = false
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = 0
    }
    for (const s of runtimes) for (const v of s.videos) v.pause()
  }

  // Pause while the surface is off-screen so a hidden loop costs nothing.
  function onVisibility(): void {
    if (document.hidden) pause()
    else play()
  }

  // Re-fit whenever the box resolves or changes size; onMounted can fire before
  // the aspect-ratio box has a size, which would scale against a stale box.
  let resizeObserver: ResizeObserver | null = null

  onMounted(() => {
    collectRuntimes()
    fitStage()
    render()
    window.addEventListener('resize', fitStage)
    const wrap = stageRef.value?.parentElement
    if (wrap && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => fitStage())
      resizeObserver.observe(wrap)
    }
    if (reduced.value) return // paint frame 0 as a still, never advance
    document.addEventListener('visibilitychange', onVisibility)
    // Don't start on a hidden tab; onVisibility begins playback when it shows.
    if (!document.hidden) play()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', fitStage)
    document.removeEventListener('visibilitychange', onVisibility)
    resizeObserver?.disconnect()
    resizeObserver = null
    pause()
  })

  return { reduced, play, pause }
}
