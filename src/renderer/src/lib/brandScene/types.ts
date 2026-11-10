export interface Keyframe {
  t: number
  v: number[]
  eo?: [number, number]
  ei?: [number, number]
}

export interface SceneVideo {
  src: string
  srcW: number
  srcH: number
  ip: number
  op: number
  st: number
  scale: Keyframe[]
  pos: Keyframe[]
  anchor: [number, number]
}

export interface Scene {
  id: string
  name: string
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
  duration: number
  compW: number
  compH: number
  scenes: Scene[]
}
