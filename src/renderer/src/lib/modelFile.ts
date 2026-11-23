import { Mesh, MeshStandardMaterial, Points, PointsMaterial, Texture } from 'three'
import type { BufferGeometry, Material, Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

const UNTEXTURED_BASE = 0xa9a49b
const DEFAULT_WHITE = 0xffffff
const GLB_MAGIC = 0x46546c67
const GLB_JSON_CHUNK = 0x4e4f534a
const GLB_HEADER_BYTES = 20
const PLY_HEADER_BYTES = 64 * 1024

export interface ModelLoad {
  parse(bytes: Uint8Array, fileName: string): Promise<Object3D | null>
  release(): void
}

interface ImageLoader {
  load(
    url: string,
    onLoad?: (image: unknown) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void
  ): unknown
}

function extensionOf(fileName: string): string {
  return fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
}

function plyHasFaces(bytes: Uint8Array): boolean {
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, PLY_HEADER_BYTES))
  const faces = /^element\s+face\s+(\d+)/m.exec(header.slice(0, header.indexOf('end_header')))
  return Number(faces?.[1] ?? 0) > 0
}

export function isSelfContainedGlb(bytes: Uint8Array): boolean {
  if (bytes.byteLength < GLB_HEADER_BYTES) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(16, true) !== GLB_JSON_CHUNK) {
    return false
  }
  const jsonEnd = GLB_HEADER_BYTES + view.getUint32(12, true)
  try {
    const json: unknown = JSON.parse(
      new TextDecoder().decode(bytes.subarray(GLB_HEADER_BYTES, jsonEnd))
    )
    const { buffers = [], images = [] } = (json ?? {}) as { buffers?: unknown; images?: unknown }
    if (!Array.isArray(buffers) || !Array.isArray(images)) return false
    return [...buffers, ...images].every(
      (part) => part !== null && typeof part === 'object' && !('uri' in part)
    )
  } catch {
    return false
  }
}

function meshFrom(geometry: BufferGeometry): Mesh {
  if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals()
  const material = new MeshStandardMaterial({
    color: UNTEXTURED_BASE,
    vertexColors: geometry.hasAttribute('color')
  })
  return new Mesh(geometry, material)
}

function pointsFrom(geometry: BufferGeometry): Points {
  const material = new PointsMaterial({
    color: UNTEXTURED_BASE,
    size: 2,
    sizeAttenuation: false,
    vertexColors: geometry.hasAttribute('color')
  })
  return new Points(geometry, material)
}

function materialsOf(object: Object3D): Material[] {
  const { material } = object as Partial<Mesh>
  return material ? [material].flat() : []
}

export function tintUntexturedWhite(model: Object3D): void {
  model.traverse((object) => {
    for (const material of materialsOf(object)) {
      const plain = material as Partial<MeshStandardMaterial>
      if (!plain.map && plain.color?.getHex() === DEFAULT_WHITE) plain.color.setHex(UNTEXTURED_BASE)
    }
  })
}

function disposeScenes(scenes: Object3D[]): void {
  const freed = new Set<{ dispose(): void }>()
  const free = (resource: { dispose(): void }): void => {
    if (freed.has(resource)) return
    freed.add(resource)
    resource.dispose()
  }
  for (const scene of scenes) {
    scene.traverse((object) => {
      const { geometry } = object as Partial<Mesh>
      if (geometry) free(geometry)
      for (const material of materialsOf(object)) {
        for (const value of Object.values(material)) if (value instanceof Texture) free(value)
        free(material)
      }
    })
  }
}

export function startModelLoad(): ModelLoad {
  const pictures = new Set<ImageBitmap>()
  const scenes: Object3D[] = []
  let released = false

  function own(picture: unknown): void {
    if (!(picture instanceof ImageBitmap)) return
    if (released) picture.close()
    else pictures.add(picture)
  }

  function keep(found: Object3D[]): void {
    if (released) disposeScenes(found)
    else scenes.push(...found)
  }

  function recordPictures(parser: GLTFParser): { name: string } {
    const loader = (parser as unknown as { textureLoader: ImageLoader }).textureLoader
    const load = loader.load.bind(loader)
    loader.load = (url, onLoad, onProgress, onError) =>
      load(
        url,
        (picture) => {
          own(picture)
          onLoad?.(picture)
        },
        onProgress,
        onError
      )
    return { name: 'desktop_owned_pictures' }
  }

  async function parseGlb(bytes: Uint8Array, buffer: ArrayBuffer): Promise<Object3D | null> {
    if (!isSelfContainedGlb(bytes)) return null
    const loader = new GLTFLoader().register(recordPictures)
    const { scene, scenes: all } = await loader.parseAsync(buffer, '')
    keep([...new Set([scene, ...all])])
    return scene
  }

  function shapeOf(bytes: Uint8Array, buffer: ArrayBuffer, extension: string): Object3D | null {
    switch (extension) {
      case 'obj':
        return new OBJLoader().parse(new TextDecoder().decode(bytes))
      case 'stl':
        return meshFrom(new STLLoader().parse(buffer))
      case 'ply': {
        const geometry = new PLYLoader().parse(buffer)
        return plyHasFaces(bytes) ? meshFrom(geometry) : pointsFrom(geometry)
      }
      default:
        return null
    }
  }

  return {
    async parse(bytes, fileName) {
      const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      const buffer = (whole ? bytes.buffer : bytes.slice().buffer) as ArrayBuffer
      const extension = extensionOf(fileName)
      if (extension === 'glb') return parseGlb(bytes, buffer)
      const shape = shapeOf(bytes, buffer, extension)
      if (shape) keep([shape])
      return shape
    },
    release() {
      released = true
      disposeScenes(scenes.splice(0))
      for (const picture of pictures) picture.close()
      pictures.clear()
    }
  }
}
