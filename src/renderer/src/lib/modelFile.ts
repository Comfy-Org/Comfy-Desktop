import { Mesh, MeshStandardMaterial, Points, PointsMaterial, Texture } from 'three'
import type { BufferGeometry, Material, Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

const UNTEXTURED_BASE = 0xa9a49b
const DEFAULT_WHITE = 0xffffff

function extensionOf(fileName: string): string {
  return fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
}

function meshFrom(geometry: BufferGeometry): Mesh {
  if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals()
  const material = new MeshStandardMaterial({
    color: UNTEXTURED_BASE,
    vertexColors: geometry.hasAttribute('color')
  })
  return new Mesh(geometry, material)
}

function shapeFrom(geometry: BufferGeometry): Mesh | Points {
  if (geometry.index) return meshFrom(geometry)
  const material = new PointsMaterial({
    color: UNTEXTURED_BASE,
    size: 2,
    sizeAttenuation: false,
    vertexColors: geometry.hasAttribute('color')
  })
  return new Points(geometry, material)
}

export async function parseModel(bytes: Uint8Array, fileName: string): Promise<Object3D | null> {
  const whole = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
  const buffer = (whole ? bytes.buffer : bytes.slice().buffer) as ArrayBuffer
  switch (extensionOf(fileName)) {
    case 'glb':
      return (await new GLTFLoader().parseAsync(buffer, '')).scene
    case 'obj':
      return new OBJLoader().parse(new TextDecoder().decode(bytes))
    case 'stl':
      return meshFrom(new STLLoader().parse(buffer))
    case 'ply':
      return shapeFrom(new PLYLoader().parse(buffer))
    default:
      return null
  }
}

export function tintUntexturedWhite(model: Object3D): void {
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const plain = material as Partial<MeshStandardMaterial>
      if (!plain.map && plain.color?.getHex() === DEFAULT_WHITE) plain.color.setHex(UNTEXTURED_BASE)
    }
  })
}

function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (!(value instanceof Texture)) continue
    if (value.image instanceof ImageBitmap) value.image.close()
    value.dispose()
  }
  material.dispose()
}

export function disposeModel(model: Object3D): void {
  model.traverse((object) => {
    if (!(object instanceof Mesh) && !(object instanceof Points)) return
    object.geometry.dispose()
    const materials: Material[] = [object.material].flat()
    materials.forEach(disposeMaterial)
  })
}
