/**
 * Scene data for the install-wait animation. A scene is a rounded-rect mask
 * that travels and resizes on keyframed paths; its video layers cross-cut by
 * frame window (`ip`/`op`). Consumed by `useBrandScene.ts`.
 */

/** One keyframe: value at frame `t`, with optional out/in bezier tangents. */
export interface Keyframe {
  t: number
  v: number[]
  eo?: [number, number]
  ei?: [number, number]
}

/** A video layer within a scene, visible for precomp frames [ip, op). */
export interface SceneVideo {
  src: string
  srcW: number
  srcH: number
  ip: number
  op: number
  /** Frame the source clip is pinned to at the layer's start. */
  st: number
  scale: Keyframe[]
  pos: Keyframe[]
  anchor: [number, number]
}

export interface Scene {
  id: string
  name: string
  /** Precomp time offset: precompFrame = masterFrame - outerSt. */
  outerSt: number
  outerPos: Keyframe[]
  compW: number
  compH: number
  fillColor: number[]
  maskPos: Keyframe[]
  maskSize: Keyframe[]
  maskRadius: number
  maskGroupOffset: [number, number]
  videos: SceneVideo[]
}

export interface BrandScene {
  fps: number
  /** Total loop length in frames. */
  duration: number
  compW: number
  compH: number
  scenes: Scene[]
}
